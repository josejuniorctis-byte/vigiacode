import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import type { VigiaCodeDatabase } from './client.js';
import {
  bindingFileCache,
  bindingScans,
  bindings,
  type Binding,
  type BindingFileCache,
  type BindingLayer,
  type BindingScan,
  type BindingStatus,
} from './schema.js';

/**
 * Repositório do detector de amarrações.
 *
 * Regras de negócio importantes que vivem aqui:
 * - a identidade de uma amarração é (project, rule, layer, entity, field);
 * - uma amarração que deixa de ser detectada é marcada como resolvida, nunca apagada;
 * - amarrações aceitas como falso positivo continuam no histórico, mas fora das contagens.
 */

export interface UpsertBindingInput {
  projectId: string;
  ruleId: string;
  layer: BindingLayer;
  entity: string;
  field: string;
  status: BindingStatus;
  severity: BindingStatus;
  message: string;
  frontRef?: string | null;
  backRef?: string | null;
  dbRef?: string | null;
  suggestion?: string | null;
}

export interface UpsertBindingResult {
  binding: Binding;
  created: boolean;
  reopened: boolean;
}

export function bindingIdentityKey(
  binding: Pick<Binding, 'ruleId' | 'layer' | 'entity' | 'field'>,
): string {
  return `${binding.ruleId}\u0000${binding.layer}\u0000${binding.entity}\u0000${binding.field}`;
}

export function upsertBinding(
  db: VigiaCodeDatabase,
  input: UpsertBindingInput,
): UpsertBindingResult {
  const existing = db
    .select()
    .from(bindings)
    .where(
      and(
        eq(bindings.projectId, input.projectId),
        eq(bindings.ruleId, input.ruleId),
        eq(bindings.layer, input.layer),
        eq(bindings.entity, input.entity),
        eq(bindings.field, input.field),
      ),
    )
    .get();

  const now = new Date().toISOString();
  const refs = {
    status: input.status,
    severity: input.severity,
    message: input.message,
    frontRef: input.frontRef ?? null,
    backRef: input.backRef ?? null,
    dbRef: input.dbRef ?? null,
    suggestion: input.suggestion ?? null,
    lastSeenAt: now,
  };

  if (existing) {
    // Falso positivo aceito permanece suprimido, mas continua sendo monitorado.
    const updated = db
      .update(bindings)
      .set(
        existing.accepted
          ? {
              message: input.message,
              frontRef: refs.frontRef,
              backRef: refs.backRef,
              dbRef: refs.dbRef,
              suggestion: refs.suggestion,
              lastSeenAt: now,
            }
          : { ...refs, resolvedAt: null },
      )
      .where(eq(bindings.id, existing.id))
      .returning()
      .get();

    return {
      binding: updated ?? existing,
      created: false,
      reopened: existing.resolvedAt !== null,
    };
  }

  const inserted = db
    .insert(bindings)
    .values({
      projectId: input.projectId,
      ruleId: input.ruleId,
      layer: input.layer,
      entity: input.entity,
      field: input.field,
      ...refs,
      firstSeenAt: now,
      accepted: false,
    })
    .returning()
    .get();

  if (!inserted) throw new Error('Não foi possível gravar a amarração no banco local.');
  return { binding: inserted, created: true, reopened: false };
}

/** Marca como resolvidas as amarrações ativas que não apareceram no scan atual. */
export function resolveBindingsNotSeen(
  db: VigiaCodeDatabase,
  projectId: string,
  seenKeys: ReadonlySet<string>,
  resolvedAt: string = new Date().toISOString(),
): Binding[] {
  const active = db
    .select()
    .from(bindings)
    .where(and(eq(bindings.projectId, projectId), sql`${bindings.resolvedAt} IS NULL`))
    .all();

  const resolved: Binding[] = [];
  for (const binding of active) {
    if (seenKeys.has(bindingIdentityKey(binding))) continue;
    const updated = db
      .update(bindings)
      .set({ resolvedAt })
      .where(eq(bindings.id, binding.id))
      .returning()
      .get();
    if (updated) resolved.push(updated);
  }
  return resolved;
}

export interface ListBindingsOptions {
  status?: BindingStatus | undefined;
  layer?: BindingLayer | undefined;
  rule?: string | undefined;
  entity?: string | undefined;
  search?: string | undefined;
  includeResolved?: boolean | undefined;
  includeAccepted?: boolean | undefined;
  limit?: number | undefined;
}

export function listBindings(
  db: VigiaCodeDatabase,
  projectId: string,
  options: ListBindingsOptions = {},
): Binding[] {
  const filters = [eq(bindings.projectId, projectId)];

  if (options.status) filters.push(eq(bindings.status, options.status));
  if (options.layer) filters.push(eq(bindings.layer, options.layer));
  if (options.rule) filters.push(eq(bindings.ruleId, options.rule));
  if (options.entity) filters.push(eq(bindings.entity, options.entity));
  if (!options.includeResolved) filters.push(sql`${bindings.resolvedAt} IS NULL`);
  if (!options.includeAccepted) filters.push(eq(bindings.accepted, false));

  if (options.search) {
    const term = `%${options.search}%`;
    const clause = or(
      like(bindings.entity, term),
      like(bindings.field, term),
      like(bindings.message, term),
    );
    if (clause) filters.push(clause);
  }

  const limit = clampBindingLimit(options.limit);
  return db
    .select()
    .from(bindings)
    .where(and(...filters))
    .orderBy(desc(bindings.lastSeenAt), desc(bindings.id))
    .limit(limit)
    .all();
}

export function findBindingById(db: VigiaCodeDatabase, id: string): Binding | undefined {
  return db.select().from(bindings).where(eq(bindings.id, id)).get();
}

export function acceptBinding(db: VigiaCodeDatabase, id: string): Binding | undefined {
  return db
    .update(bindings)
    .set({ accepted: true, lastSeenAt: new Date().toISOString() })
    .where(eq(bindings.id, id))
    .returning()
    .get();
}

export interface BindingRuleCount {
  ruleId: string;
  red: number;
  yellow: number;
  green: number;
}

export interface BindingLayerCount {
  layer: BindingLayer;
  red: number;
  yellow: number;
  green: number;
}

export interface BindingSummary {
  red: number;
  yellow: number;
  green: number;
  total: number;
  active: number;
  resolved: number;
  accepted: number;
  healthPercent: number;
  byRule: BindingRuleCount[];
  byLayer: BindingLayerCount[];
  lastScan: BindingScan | null;
}

export function summarizeBindings(
  db: VigiaCodeDatabase,
  projectId: string,
  lastScan: BindingScan | null = getLatestBindingScan(db, projectId),
): BindingSummary {
  const rows = db.select().from(bindings).where(eq(bindings.projectId, projectId)).all();

  let red = 0;
  let yellow = 0;
  let green = 0;
  let resolved = 0;
  let accepted = 0;
  const byRule = new Map<string, BindingRuleCount>();
  const byLayer = new Map<BindingLayer, BindingLayerCount>();

  for (const row of rows) {
    if (row.accepted) accepted += 1;
    if (row.resolvedAt !== null) {
      resolved += 1;
      continue;
    }
    if (row.accepted) continue;

    if (row.status === 'red') red += 1;
    else if (row.status === 'yellow') yellow += 1;
    else green += 1;

    const rule = byRule.get(row.ruleId) ?? { ruleId: row.ruleId, red: 0, yellow: 0, green: 0 };
    rule[row.status] += 1;
    byRule.set(row.ruleId, rule);

    const layer = byLayer.get(row.layer) ?? { layer: row.layer, red: 0, yellow: 0, green: 0 };
    layer[row.status] += 1;
    byLayer.set(row.layer, layer);
  }

  const active = red + yellow + green;
  return {
    red,
    yellow,
    green,
    total: rows.length,
    active,
    resolved,
    accepted,
    healthPercent: active === 0 ? 100 : Math.round((green / active) * 100),
    byRule: [...byRule.values()].sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
    byLayer: [...byLayer.values()].sort((left, right) => left.layer.localeCompare(right.layer)),
    lastScan,
  };
}

export interface InsertBindingScanInput {
  projectId: string;
  trigger: 'manual' | 'watch' | 'start';
  batchId?: string | null;
  startedAt?: string;
}

export function insertBindingScan(
  db: VigiaCodeDatabase,
  input: InsertBindingScanInput,
): BindingScan {
  const inserted = db
    .insert(bindingScans)
    .values({
      projectId: input.projectId,
      trigger: input.trigger,
      batchId: input.batchId ?? null,
      startedAt: input.startedAt ?? new Date().toISOString(),
    })
    .returning()
    .get();

  if (!inserted) throw new Error('Não foi possível registrar o scan de amarrações.');
  return inserted;
}

export interface FinishBindingScanInput {
  filesScanned: number;
  red: number;
  yellow: number;
  green: number;
  created: number;
  resolved: number;
  matrixJson?: string | null;
  error?: string | null;
  finishedAt?: string;
}

export function finishBindingScan(
  db: VigiaCodeDatabase,
  scanId: string,
  input: FinishBindingScanInput,
): BindingScan | undefined {
  return db
    .update(bindingScans)
    .set({
      finishedAt: input.finishedAt ?? new Date().toISOString(),
      filesScanned: input.filesScanned,
      redCount: input.red,
      yellowCount: input.yellow,
      greenCount: input.green,
      createdCount: input.created,
      resolvedCount: input.resolved,
      matrixJson: input.matrixJson ?? null,
      error: input.error ?? null,
    })
    .where(eq(bindingScans.id, scanId))
    .returning()
    .get();
}

export function listBindingScans(
  db: VigiaCodeDatabase,
  projectId: string,
  limit = 50,
): BindingScan[] {
  return db
    .select()
    .from(bindingScans)
    .where(eq(bindingScans.projectId, projectId))
    .orderBy(desc(bindingScans.startedAt), desc(bindingScans.id))
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200))
    .all();
}

export function getLatestBindingScan(db: VigiaCodeDatabase, projectId: string): BindingScan | null {
  const row = db
    .select()
    .from(bindingScans)
    .where(eq(bindingScans.projectId, projectId))
    .orderBy(desc(bindingScans.startedAt), desc(bindingScans.id))
    .limit(1)
    .get();
  return row ?? null;
}

export interface PutBindingFileCacheInput {
  projectId: string;
  filePath: string;
  hash: string;
  layer: BindingLayer;
  extractor: string;
  data: string;
}

export function putBindingFileCache(
  db: VigiaCodeDatabase,
  input: PutBindingFileCacheInput,
): BindingFileCache {
  const existing = db
    .select()
    .from(bindingFileCache)
    .where(
      and(
        eq(bindingFileCache.projectId, input.projectId),
        eq(bindingFileCache.filePath, input.filePath),
      ),
    )
    .get();

  const now = new Date().toISOString();
  if (existing) {
    const updated = db
      .update(bindingFileCache)
      .set({ ...input, updatedAt: now })
      .where(eq(bindingFileCache.id, existing.id))
      .returning()
      .get();
    if (updated) return updated;
  }

  const inserted = db
    .insert(bindingFileCache)
    .values({ ...input, updatedAt: now })
    .returning()
    .get();
  if (!inserted) throw new Error('Não foi possível gravar o cache de extração.');
  return inserted;
}

export function listBindingFileCache(db: VigiaCodeDatabase, projectId: string): BindingFileCache[] {
  return db.select().from(bindingFileCache).where(eq(bindingFileCache.projectId, projectId)).all();
}

export function deleteBindingFileCache(
  db: VigiaCodeDatabase,
  projectId: string,
  filePath: string,
): void {
  db.delete(bindingFileCache)
    .where(and(eq(bindingFileCache.projectId, projectId), eq(bindingFileCache.filePath, filePath)))
    .run();
}

export function clearBindingFileCache(db: VigiaCodeDatabase, projectId: string): void {
  db.delete(bindingFileCache).where(eq(bindingFileCache.projectId, projectId)).run();
}

export function clampBindingLimit(limit: number | undefined, fallback = 200): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 1000);
}
