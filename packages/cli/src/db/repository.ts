import { and, desc, eq, gte, like, lt, lte, or, type SQL } from 'drizzle-orm';
import type { VigiaCodeDatabase } from './client.js';
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
export function registerProject(db: VigiaCodeDatabase, input: RegisterProjectInput): Project {
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
  db: VigiaCodeDatabase,
  rootPath: string,
): Project | undefined {
  return db.select().from(projects).where(eq(projects.rootPath, rootPath)).get();
}

export function findProjectById(db: VigiaCodeDatabase, id: string): Project | undefined {
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
  db: VigiaCodeDatabase,
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

export function findChangeEventById(db: VigiaCodeDatabase, id: string): ChangeEvent | undefined {
  return db.select().from(changeEvents).where(eq(changeEvents.id, id)).get();
}

export function updateChangeEventSummary(
  db: VigiaCodeDatabase,
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
  /** Filtra por caminho exato (histórico de arquivo). */
  filePath?: string | undefined;
  /** Busca em file_path ou summary. */
  search?: string | undefined;
  /** Início do período (ISO). */
  from?: string | undefined;
  /** Fim do período (ISO). */
  to?: string | undefined;
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
  db: VigiaCodeDatabase,
  projectId: string,
  options: ListChangeEventsOptions = {},
): ChangeEvent[] {
  const safeLimit = clampLimit(options.limit);
  const filters: SQL[] = [eq(changeEvents.projectId, projectId)];

  if (options.layer) {
    filters.push(eq(changeEvents.layer, options.layer));
  }
  if (options.filePath) {
    filters.push(eq(changeEvents.filePath, options.filePath));
  }
  if (options.search) {
    const term = `%${options.search}%`;
    const searchFilter = or(like(changeEvents.filePath, term), like(changeEvents.summary, term));
    if (searchFilter) filters.push(searchFilter);
  }
  if (options.from) {
    filters.push(gte(changeEvents.createdAt, options.from));
  }
  if (options.to) {
    filters.push(lte(changeEvents.createdAt, options.to));
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
  db: VigiaCodeDatabase,
  projectId: string,
  limit = 50,
): ChangeEvent[] {
  return listChangeEvents(db, projectId, { limit });
}

/** Histórico de um arquivo específico. */
export function listFileEvents(
  db: VigiaCodeDatabase,
  projectId: string,
  filePath: string,
  options: Omit<ListChangeEventsOptions, 'filePath'> = {},
): ChangeEvent[] {
  return listChangeEvents(db, projectId, { ...options, filePath });
}

export function listSnapshots(db: VigiaCodeDatabase, projectId: string, limit = 100): Snapshot[] {
  return db
    .select()
    .from(snapshots)
    .where(eq(snapshots.projectId, projectId))
    .orderBy(desc(snapshots.createdAt))
    .limit(clampLimit(limit, 100))
    .all();
}

export interface StatsDay {
  date: string;
  events: number;
  files: number;
  batches: number;
  layers: Partial<Record<ChangeEventLayer, number>>;
}

export interface StatsFile {
  filePath: string;
  layer: ChangeEventLayer;
  events: number;
  lastSummary: string | null;
  lastChangedAt: string;
}

export interface ProjectStats {
  totalEvents: number;
  totalBatches: number;
  totalFiles: number;
  byDay: StatsDay[];
  byLayer: Array<{ layer: ChangeEventLayer; events: number }>;
  topFiles: StatsFile[];
}

/**
 * Estatísticas agregadas do projeto. Usa os eventos mais recentes (limite de
 * segurança) para manter a resposta rápida em bases locais.
 */
export function getProjectStats(
  db: VigiaCodeDatabase,
  projectId: string,
  maxEvents = 5000,
): ProjectStats {
  const rows = db
    .select({
      id: changeEvents.id,
      batchId: changeEvents.batchId,
      filePath: changeEvents.filePath,
      layer: changeEvents.layer,
      summary: changeEvents.summary,
      createdAt: changeEvents.createdAt,
    })
    .from(changeEvents)
    .where(eq(changeEvents.projectId, projectId))
    .orderBy(desc(changeEvents.createdAt), desc(changeEvents.id))
    .limit(Math.max(1, Math.min(maxEvents, 20_000)))
    .all();

  const batches = new Set<string>();
  const files = new Set<string>();
  const days = new Map<
    string,
    {
      files: Set<string>;
      batches: Set<string>;
      events: number;
      layers: Map<ChangeEventLayer, number>;
    }
  >();
  const layers = new Map<ChangeEventLayer, number>();
  const topFiles = new Map<string, StatsFile>();

  for (const row of rows) {
    if (row.batchId) batches.add(row.batchId);
    files.add(row.filePath);
    layers.set(row.layer, (layers.get(row.layer) ?? 0) + 1);

    const date = row.createdAt.slice(0, 10);
    const day = days.get(date) ?? {
      files: new Set<string>(),
      batches: new Set<string>(),
      events: 0,
      layers: new Map<ChangeEventLayer, number>(),
    };
    day.events += 1;
    day.files.add(row.filePath);
    if (row.batchId) day.batches.add(row.batchId);
    day.layers.set(row.layer, (day.layers.get(row.layer) ?? 0) + 1);
    days.set(date, day);

    const file = topFiles.get(row.filePath);
    if (file) {
      file.events += 1;
      if (!file.lastSummary && row.summary) file.lastSummary = row.summary;
    } else {
      topFiles.set(row.filePath, {
        filePath: row.filePath,
        layer: row.layer,
        events: 1,
        lastSummary: row.summary,
        lastChangedAt: row.createdAt,
      });
    }
  }

  return {
    totalEvents: rows.length,
    totalBatches: batches.size,
    totalFiles: files.size,
    byDay: [...days.entries()]
      .map(([date, day]) => ({
        date,
        events: day.events,
        files: day.files.size,
        batches: day.batches.size,
        layers: Object.fromEntries(day.layers) as Partial<Record<ChangeEventLayer, number>>,
      }))
      .sort((left, right) => right.date.localeCompare(left.date)),
    byLayer: [...layers.entries()]
      .map(([layer, events]) => ({ layer, events }))
      .sort((left, right) => right.events - left.events),
    topFiles: [...topFiles.values()].sort((left, right) => right.events - left.events).slice(0, 20),
  };
}

/** Resolve o cursor de paginação; retorna null para cursor inválido. */
export function resolveEventCursor(
  db: VigiaCodeDatabase,
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

export function countChangeEvents(db: VigiaCodeDatabase, projectId: string): number {
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

export function insertSnapshot(db: VigiaCodeDatabase, input: InsertSnapshotInput): Snapshot {
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

export function getLatestSnapshot(db: VigiaCodeDatabase, projectId: string): Snapshot | undefined {
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
