import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { VigiaCodeDatabase } from './client.js';
import {
  roadmapItems,
  roadmapLinks,
  type RoadmapChecklistEntry,
  type RoadmapItem,
  type RoadmapKind,
  type RoadmapLink,
  type RoadmapPriority,
  type RoadmapSource,
  type RoadmapStatus,
} from './schema.js';

/**
 * Repositório do roadmap vivo (Arquiteto, Etapa 5).
 *
 * Itens gerados são identificados por (project, kind, source, sourceRef) e
 * podem ser atualizados/fechados por evidência. Itens manuais nunca são
 * fechados nem apagados automaticamente.
 */

export interface RoadmapLinkView {
  bindingId: string | null;
  filePath: string | null;
  commitSha: string | null;
}

export interface RoadmapChecklistInput {
  label: string;
  done: boolean;
  evidence?: string | null;
}

export interface RoadmapItemView extends Omit<RoadmapItem, 'evidenceJson' | 'checklistJson'> {
  evidence: string[];
  checklist: RoadmapChecklistEntry[];
  links: RoadmapLinkView[];
}

export interface ListRoadmapOptions {
  status?: RoadmapStatus | undefined;
  kind?: RoadmapKind | undefined;
  priority?: RoadmapPriority | undefined;
  module?: string | undefined;
  source?: RoadmapSource | undefined;
  search?: string | undefined;
  limit?: number | undefined;
}

export interface UpsertGeneratedItemInput {
  projectId: string;
  title: string;
  description?: string;
  kind: RoadmapKind;
  priority: RoadmapPriority;
  source: RoadmapSource;
  sourceRef: string;
  module?: string | null;
  evidence?: string[];
  checklist?: RoadmapChecklistInput[];
  links?: RoadmapLinkView[];
}

export function serializeEvidence(evidence: readonly string[] | undefined): string | null {
  return evidence && evidence.length > 0 ? JSON.stringify(evidence) : null;
}

export function serializeChecklist(
  checklist: readonly RoadmapChecklistInput[] | undefined,
): string | null {
  return checklist && checklist.length > 0 ? JSON.stringify(checklist) : null;
}

export function parseEvidence(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function parseChecklist(raw: string | null): RoadmapChecklistEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RoadmapChecklistEntry =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as RoadmapChecklistEntry).label === 'string' &&
          typeof (item as RoadmapChecklistEntry).done === 'boolean',
      )
      .map((item) => ({
        label: item.label,
        done: item.done,
        evidence: typeof item.evidence === 'string' ? item.evidence : null,
      }));
  } catch {
    return [];
  }
}

function toView(item: RoadmapItem, db: VigiaCodeDatabase): RoadmapItemView {
  const links = db.select().from(roadmapLinks).where(eq(roadmapLinks.itemId, item.id)).all();
  const { evidenceJson, checklistJson, ...rest } = item;
  return {
    ...rest,
    evidence: parseEvidence(evidenceJson),
    checklist: parseChecklist(checklistJson),
    links: links.map(toLinkView),
  };
}

function toLinkView(link: RoadmapLink): RoadmapLinkView {
  return { bindingId: link.bindingId, filePath: link.filePath, commitSha: link.commitSha };
}

export function findRoadmapItem(db: VigiaCodeDatabase, id: string): RoadmapItemView | undefined {
  const item = db.select().from(roadmapItems).where(eq(roadmapItems.id, id)).get();
  return item ? toView(item, db) : undefined;
}

export function listRoadmapItems(
  db: VigiaCodeDatabase,
  projectId: string,
  options: ListRoadmapOptions = {},
): RoadmapItemView[] {
  const filters = [eq(roadmapItems.projectId, projectId)];
  if (options.status) filters.push(eq(roadmapItems.status, options.status));
  if (options.kind) filters.push(eq(roadmapItems.kind, options.kind));
  if (options.priority) filters.push(eq(roadmapItems.priority, options.priority));
  if (options.module) filters.push(eq(roadmapItems.module, options.module));
  if (options.source) filters.push(eq(roadmapItems.source, options.source));
  if (options.search) {
    const term = `%${options.search}%`;
    const clause = or(
      like(roadmapItems.title, term),
      like(roadmapItems.description, term),
      like(roadmapItems.sourceRef, term),
    );
    if (clause) filters.push(clause);
  }

  const limit = clampRoadmapLimit(options.limit);
  const rows = db
    .select()
    .from(roadmapItems)
    .where(and(...filters))
    .orderBy(desc(roadmapItems.updatedAt), desc(roadmapItems.id))
    .limit(limit)
    .all();

  const links =
    rows.length === 0
      ? []
      : db
          .select()
          .from(roadmapLinks)
          .where(
            inArray(
              roadmapLinks.itemId,
              rows.map((row) => row.id),
            ),
          )
          .all();
  const linksByItem = new Map<string, RoadmapLinkView[]>();
  for (const link of links) {
    const bucket = linksByItem.get(link.itemId) ?? [];
    bucket.push(toLinkView(link));
    linksByItem.set(link.itemId, bucket);
  }

  return rows.map((row) => {
    const { evidenceJson, checklistJson, ...rest } = row;
    return {
      ...rest,
      evidence: parseEvidence(evidenceJson),
      checklist: parseChecklist(checklistJson),
      links: linksByItem.get(row.id) ?? [],
    };
  });
}

export function countRoadmapItems(
  db: VigiaCodeDatabase,
  projectId: string,
): Record<RoadmapStatus, number> {
  const rows = db
    .select({ status: roadmapItems.status })
    .from(roadmapItems)
    .where(eq(roadmapItems.projectId, projectId))
    .all();
  const counts: Record<RoadmapStatus, number> = { todo: 0, doing: 0, done: 0, blocked: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export interface CreateRoadmapItemInput {
  projectId: string;
  title: string;
  description?: string;
  kind: RoadmapKind;
  status?: RoadmapStatus;
  priority: RoadmapPriority;
  source: RoadmapSource;
  sourceRef?: string | null;
  module?: string | null;
  evidence?: string[];
  checklist?: RoadmapChecklistInput[];
  links?: RoadmapLinkView[];
}

export function createRoadmapItem(
  db: VigiaCodeDatabase,
  input: CreateRoadmapItemInput,
): RoadmapItemView {
  const now = new Date().toISOString();
  const inserted = db
    .insert(roadmapItems)
    .values({
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? '',
      kind: input.kind,
      status: input.status ?? 'todo',
      priority: input.priority,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      module: input.module ?? null,
      createdAt: now,
      updatedAt: now,
      doneAt: input.status === 'done' ? now : null,
      evidenceJson: serializeEvidence(input.evidence),
      checklistJson: serializeChecklist(input.checklist),
    })
    .returning()
    .get();
  if (!inserted) throw new Error('Não foi possível gravar o item do roadmap.');
  replaceLinks(db, inserted.id, input.links);
  return toView(inserted, db);
}

/**
 * Cria ou atualiza um item gerado. Se ele estava "done" e o problema reaparece,
 * volta para "todo" com evidência de reabertura. Itens em doing/blocked mantêm
 * o status manual atual.
 */
export function upsertGeneratedItem(
  db: VigiaCodeDatabase,
  input: UpsertGeneratedItemInput,
): { item: RoadmapItemView; created: boolean; reopened: boolean; closed: boolean } {
  const existing = db
    .select()
    .from(roadmapItems)
    .where(
      and(
        eq(roadmapItems.projectId, input.projectId),
        eq(roadmapItems.kind, input.kind),
        eq(roadmapItems.source, input.source),
        eq(roadmapItems.sourceRef, input.sourceRef),
      ),
    )
    .get();

  const now = new Date().toISOString();
  if (!existing) {
    return {
      item: createRoadmapItem(db, input),
      created: true,
      reopened: false,
      closed: false,
    };
  }

  const reopen = existing.status === 'done';
  const evidence = [...parseEvidence(existing.evidenceJson)];
  if (reopen) evidence.unshift(`reaberto em ${now}`);

  const updated = db
    .update(roadmapItems)
    .set({
      title: input.title,
      description: input.description ?? existing.description,
      priority: input.priority,
      module: input.module ?? existing.module,
      status: reopen ? 'todo' : existing.status,
      doneAt: reopen ? null : existing.doneAt,
      evidenceJson: serializeEvidence(evidence),
      checklistJson: serializeChecklist(input.checklist) ?? existing.checklistJson,
      updatedAt: now,
    })
    .where(eq(roadmapItems.id, existing.id))
    .returning()
    .get();

  if (!updated) throw new Error('Não foi possível atualizar o item do roadmap.');
  replaceLinks(db, updated.id, input.links);
  return { item: toView(updated, db), created: false, reopened: reopen, closed: false };
}

export function updateRoadmapStatus(
  db: VigiaCodeDatabase,
  id: string,
  status: RoadmapStatus,
  note?: string,
): RoadmapItemView | undefined {
  const existing = db.select().from(roadmapItems).where(eq(roadmapItems.id, id)).get();
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const description = note ? appendNote(existing.description, note, now) : existing.description;
  const updated = db
    .update(roadmapItems)
    .set({
      status,
      description,
      doneAt: status === 'done' ? now : null,
      updatedAt: now,
    })
    .where(eq(roadmapItems.id, id))
    .returning()
    .get();
  return updated ? toView(updated, db) : undefined;
}

export function closeRoadmapItem(
  db: VigiaCodeDatabase,
  id: string,
  evidence: string,
): RoadmapItemView | undefined {
  const existing = db.select().from(roadmapItems).where(eq(roadmapItems.id, id)).get();
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const items = parseEvidence(existing.evidenceJson);
  items.unshift(evidence);
  const checklist = parseChecklist(existing.checklistJson).map((entry) => ({
    ...entry,
    done: true,
  }));
  const updated = db
    .update(roadmapItems)
    .set({
      status: 'done',
      doneAt: now,
      updatedAt: now,
      evidenceJson: serializeEvidence(items),
      checklistJson: serializeChecklist(checklist),
    })
    .where(eq(roadmapItems.id, id))
    .returning()
    .get();
  return updated ? toView(updated, db) : undefined;
}

export function appendRoadmapNote(
  db: VigiaCodeDatabase,
  id: string,
  note: string,
): RoadmapItemView | undefined {
  const existing = db.select().from(roadmapItems).where(eq(roadmapItems.id, id)).get();
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated = db
    .update(roadmapItems)
    .set({ description: appendNote(existing.description, note, now), updatedAt: now })
    .where(eq(roadmapItems.id, id))
    .returning()
    .get();
  return updated ? toView(updated, db) : undefined;
}

export interface UpdateRoadmapItemInput {
  title?: string;
  description?: string;
  status?: RoadmapStatus;
  priority?: RoadmapPriority;
  kind?: RoadmapKind;
  module?: string | null;
  sourceRef?: string | null;
  checklist?: RoadmapChecklistInput[];
  evidence?: string[];
}

/** Atualiza campos editáveis de um item (usado pelo PATCH e pelo MCP). */
export function updateRoadmapItem(
  db: VigiaCodeDatabase,
  id: string,
  input: UpdateRoadmapItemInput,
): RoadmapItemView | undefined {
  const existing = db.select().from(roadmapItems).where(eq(roadmapItems.id, id)).get();
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated = db
    .update(roadmapItems)
    .set({
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      status: input.status ?? existing.status,
      priority: input.priority ?? existing.priority,
      kind: input.kind ?? existing.kind,
      module: input.module === undefined ? existing.module : input.module,
      sourceRef: input.sourceRef === undefined ? existing.sourceRef : input.sourceRef,
      checklistJson:
        input.checklist !== undefined
          ? serializeChecklist(input.checklist)
          : existing.checklistJson,
      evidenceJson:
        input.evidence !== undefined ? serializeEvidence(input.evidence) : existing.evidenceJson,
      doneAt:
        input.status === undefined
          ? existing.doneAt
          : input.status === 'done'
            ? (existing.doneAt ?? now)
            : null,
      updatedAt: now,
    })
    .where(eq(roadmapItems.id, id))
    .returning()
    .get();
  return updated ? toView(updated, db) : undefined;
}

export function deleteRoadmapItem(db: VigiaCodeDatabase, id: string): boolean {
  const existing = db.select().from(roadmapItems).where(eq(roadmapItems.id, id)).get();
  if (!existing) return false;
  db.delete(roadmapItems).where(eq(roadmapItems.id, id)).run();
  return true;
}

/** Fecha itens gerados (não manuais) cujo sourceRef não aparece mais. */
export function closeGeneratedItemsNotSeen(
  db: VigiaCodeDatabase,
  projectId: string,
  kind: RoadmapKind,
  activeSourceRefs: ReadonlySet<string>,
  evidence: string,
): RoadmapItemView[] {
  const rows = db
    .select()
    .from(roadmapItems)
    .where(and(eq(roadmapItems.projectId, projectId), eq(roadmapItems.kind, kind)))
    .all();
  const closed: RoadmapItemView[] = [];
  for (const row of rows) {
    if (row.source === 'manual' || row.status === 'done' || row.status === 'blocked') continue;
    if (row.sourceRef && activeSourceRefs.has(row.sourceRef)) continue;
    const updated = closeRoadmapItem(db, row.id, evidence);
    if (updated) closed.push(updated);
  }
  return closed;
}

/** Itens gerados com sourceRef em um arquivo (usado pelo fechamento incremental). */
export function closeGeneratedItemsForFile(
  db: VigiaCodeDatabase,
  projectId: string,
  kind: RoadmapKind,
  filePath: string,
  activeLineRefs: ReadonlySet<string>,
  evidence: string,
): RoadmapItemView[] {
  const rows = db
    .select()
    .from(roadmapItems)
    .where(and(eq(roadmapItems.projectId, projectId), eq(roadmapItems.kind, kind)))
    .all();
  const closed: RoadmapItemView[] = [];
  for (const row of rows) {
    if (row.source === 'manual' || row.status === 'done' || row.status === 'blocked') continue;
    if (!row.sourceRef || !row.sourceRef.startsWith(`${filePath}:`)) continue;
    if (activeLineRefs.has(row.sourceRef)) continue;
    const updated = closeRoadmapItem(db, row.id, evidence);
    if (updated) closed.push(updated);
  }
  return closed;
}

/** Contagens de alterações recentes por arquivo (para itens de teste). */
export function listFrequentChangedFiles(
  db: VigiaCodeDatabase,
  projectId: string,
  sinceIso: string,
  minimum = 3,
  limit = 25,
): Array<{ filePath: string; changes: number; lastChangedAt: string }> {
  const rows = db
    .select({
      filePath: sql<string>`file_path`,
      changes: sql<number>`COUNT(*)`,
      lastChangedAt: sql<string>`MAX(created_at)`,
    })
    .from(sql`change_events`)
    .where(sql`project_id = ${projectId} AND created_at >= ${sinceIso}`)
    .groupBy(sql`file_path`)
    .having(sql`COUNT(*) >= ${minimum}`)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(limit)
    .all();
  return rows.map((row) => ({
    filePath: row.filePath,
    changes: Number(row.changes),
    lastChangedAt: row.lastChangedAt,
  }));
}

function replaceLinks(
  db: VigiaCodeDatabase,
  itemId: string,
  links: readonly RoadmapLinkView[] | undefined,
): void {
  if (!links) return;
  db.delete(roadmapLinks).where(eq(roadmapLinks.itemId, itemId)).run();
  for (const link of links) {
    db.insert(roadmapLinks)
      .values({
        itemId,
        bindingId: link.bindingId,
        filePath: link.filePath,
        commitSha: link.commitSha,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
}

function appendNote(description: string, note: string, iso: string): string {
  const line = `[${iso.slice(0, 16).replace('T', ' ')}] ${note}`;
  return description.length > 0 ? `${description}\n${line}` : line;
}

export function clampRoadmapLimit(limit: number | undefined, fallback = 500): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 2000);
}
