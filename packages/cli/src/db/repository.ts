import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { CodeAnchorDatabase } from './client.js';
import {
  changeEvents,
  projects,
  snapshots,
  type ChangeEvent,
  type ChangeEventLayer,
  type ChangeType,
  type Project,
  type Snapshot,
} from './schema.js';

/**
 * Repositórios: única porta de entrada para os dados. Comandos, vigia e servidor
 * nunca montam SQL — assim a troca SQLite → PostgreSQL fica restrita a esta pasta.
 */

export interface RegisterProjectInput {
  name: string;
  rootPath: string;
}

/**
 * Registra o projeto ou devolve o registro existente.
 * A raiz do projeto é a chave natural (um banco por projeto).
 */
export function registerProject(db: CodeAnchorDatabase, input: RegisterProjectInput): Project {
  const rootPath = input.rootPath;
  const existing = db.select().from(projects).where(eq(projects.rootPath, rootPath)).get();

  if (existing) {
    if (existing.name === input.name) return existing;
    const updated = db
      .update(projects)
      .set({ name: input.name })
      .where(eq(projects.id, existing.id))
      .returning()
      .get();
    return updated ?? { ...existing, name: input.name };
  }

  const inserted = db.insert(projects).values({ name: input.name, rootPath }).returning().get();

  if (!inserted) {
    throw new Error('Não foi possível registrar o projeto no banco local.');
  }
  return inserted;
}

export function findProjectByRootPath(
  db: CodeAnchorDatabase,
  rootPath: string,
): Project | undefined {
  return db.select().from(projects).where(eq(projects.rootPath, rootPath)).get();
}

export function findProjectById(db: CodeAnchorDatabase, id: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export interface InsertChangeEventInput {
  projectId: string;
  filePath: string;
  changeType: ChangeType;
  diff: string;
  summary?: string | null;
  batchId?: string | null;
  layer?: ChangeEventLayer;
  diffTruncated?: boolean;
  createdAt?: string;
}

/** Grava um lote de eventos. O summary pode chegar depois pela fila de IA. */
export function insertChangeEvents(
  db: CodeAnchorDatabase,
  inputs: InsertChangeEventInput[],
): ChangeEvent[] {
  if (inputs.length === 0) return [];

  const now = new Date().toISOString();
  const rows = inputs.map((input) => ({
    projectId: input.projectId,
    filePath: input.filePath,
    changeType: input.changeType,
    diff: input.diff,
    summary: input.summary ?? null,
    batchId: input.batchId ?? null,
    layer: input.layer ?? ('other' as const),
    diffTruncated: input.diffTruncated ?? false,
    createdAt: input.createdAt ?? now,
  }));

  return db.insert(changeEvents).values(rows).returning().all();
}

export function findChangeEventById(db: CodeAnchorDatabase, id: string): ChangeEvent | undefined {
  return db.select().from(changeEvents).where(eq(changeEvents.id, id)).get();
}

export function updateChangeEventSummary(
  db: CodeAnchorDatabase,
  id: string,
  summary: string,
): ChangeEvent | undefined {
  return db.update(changeEvents).set({ summary }).where(eq(changeEvents.id, id)).returning().get();
}

export interface ListChangeEventsOptions {
  limit?: number;
  /** Cursor: id de um evento ou timestamp ISO. */
  before?: string | undefined;
  layer?: ChangeEventLayer | undefined;
}

export interface EventCursor {
  createdAt: string;
  id: string;
}

/**
 * Eventos mais recentes primeiro, com paginação por cursor.
 * O cursor pode ser o id de um evento (recomendado) ou um timestamp ISO.
 */
export function listChangeEvents(
  db: CodeAnchorDatabase,
  projectId: string,
  options: ListChangeEventsOptions = {},
): ChangeEvent[] {
  const safeLimit = clampLimit(options.limit);
  const filters: SQL[] = [eq(changeEvents.projectId, projectId)];

  if (options.layer) {
    filters.push(eq(changeEvents.layer, options.layer));
  }

  const cursor = resolveEventCursor(db, projectId, options.before);
  if (cursor) {
    const cursorFilter = or(
      lt(changeEvents.createdAt, cursor.createdAt),
      and(eq(changeEvents.createdAt, cursor.createdAt), lt(changeEvents.id, cursor.id)),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  return db
    .select()
    .from(changeEvents)
    .where(and(...filters))
    .orderBy(desc(changeEvents.createdAt), desc(changeEvents.id))
    .limit(safeLimit)
    .all();
}

/** Compatibilidade com a API da Etapa 1. */
export function listRecentChangeEvents(
  db: CodeAnchorDatabase,
  projectId: string,
  limit = 50,
): ChangeEvent[] {
  return listChangeEvents(db, projectId, { limit });
}

/** Resolve o cursor de paginação; retorna null para cursor inválido. */
export function resolveEventCursor(
  db: CodeAnchorDatabase,
  projectId: string,
  before: string | undefined,
): EventCursor | null {
  if (!before) return null;

  const byId = findChangeEventById(db, before);
  if (byId && byId.projectId === projectId) {
    return { createdAt: byId.createdAt, id: byId.id };
  }

  const parsed = Date.parse(before);
  if (!Number.isNaN(parsed)) {
    return { createdAt: new Date(parsed).toISOString(), id: '' };
  }

  return null;
}

export function countChangeEvents(db: CodeAnchorDatabase, projectId: string): number {
  const rows = db
    .select({ id: changeEvents.id })
    .from(changeEvents)
    .where(eq(changeEvents.projectId, projectId))
    .all();
  return rows.length;
}

export interface InsertSnapshotInput {
  projectId: string;
  commitHash: string;
  createdAt?: string;
}

export function insertSnapshot(db: CodeAnchorDatabase, input: InsertSnapshotInput): Snapshot {
  const inserted = db
    .insert(snapshots)
    .values({
      projectId: input.projectId,
      commitHash: input.commitHash,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning()
    .get();

  if (!inserted) {
    throw new Error('Não foi possível registrar o snapshot no banco local.');
  }
  return inserted;
}

export function getLatestSnapshot(db: CodeAnchorDatabase, projectId: string): Snapshot | undefined {
  return db
    .select()
    .from(snapshots)
    .where(eq(snapshots.projectId, projectId))
    .orderBy(desc(snapshots.createdAt))
    .limit(1)
    .get();
}

export function clampLimit(limit: number | undefined, fallback = 50): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}
