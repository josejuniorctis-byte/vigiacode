import { randomUUID } from 'node:crypto';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/*
 * Schema inicial do CodeAnchor (SQLite).
 *
 * A camada de banco fica isolada em src/db/: apenas este arquivo conhece o dialeto.
 * Para suportar PostgreSQL no futuro, criamos src/db/schema.pg.ts e um client
 * alternativo, mantendo o restante do código falando com os repositórios.
 *
 * Timestamps: ISO 8601 em UTC (TEXT), gerados na aplicação para manter o mesmo
 * formato em qualquer dialeto.
 */

const nowIso = (): string => new Date().toISOString();

/** Camadas detectadas pelo vigia. */
export const CHANGE_EVENT_LAYERS = ['frontend', 'backend', 'database', 'config', 'other'] as const;
export type ChangeEventLayer = (typeof CHANGE_EVENT_LAYERS)[number];

export function isChangeEventLayer(value: string): value is ChangeEventLayer {
  return (CHANGE_EVENT_LAYERS as readonly string[]).includes(value);
}

export const projects = sqliteTable(
  'projects',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    rootPath: text('root_path').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  (table) => [uniqueIndex('projects_root_path_idx').on(table.rootPath)],
);

export const snapshots = sqliteTable(
  'snapshots',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    commitHash: text('commit_hash').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  (table) => [
    index('snapshots_project_id_idx').on(table.projectId),
    index('snapshots_project_commit_idx').on(table.projectId, table.commitHash),
  ],
);

export const changeEvents = sqliteTable(
  'change_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    changeType: text('change_type', { enum: ['add', 'change', 'unlink'] }).notNull(),
    diff: text('diff').notNull(),
    summary: text('summary'),
    /** Lote do vigia (várias mudanças rápidas agrupadas). */
    batchId: text('batch_id'),
    /** Camada inferida pelo caminho/extensão. */
    layer: text('layer', { enum: CHANGE_EVENT_LAYERS }).notNull().default('other'),
    /** Indica que o diff foi cortado por exceder o limite configurado. */
    diffTruncated: integer('diff_truncated', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  (table) => [
    index('change_events_project_id_idx').on(table.projectId),
    index('change_events_project_created_idx').on(table.projectId, table.createdAt),
    index('change_events_project_layer_idx').on(table.projectId, table.layer),
    index('change_events_batch_id_idx').on(table.batchId),
  ],
);

export const bindings = sqliteTable(
  'bindings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    layer: text('layer', { enum: ['frontend', 'backend', 'database'] }).notNull(),
    entity: text('entity').notNull(),
    field: text('field').notNull(),
    status: text('status', { enum: ['red', 'yellow', 'green'] }).notNull(),
    detectedAt: text('detected_at').notNull().$defaultFn(nowIso),
  },
  (table) => [
    index('bindings_project_id_idx').on(table.projectId),
    index('bindings_project_layer_idx').on(table.projectId, table.layer),
  ],
);

/** Alias mantido para quem preferir a nomenclatura de tabelas do Drizzle. */
export const schema = {
  projects,
  snapshots,
  changeEvents,
  bindings,
};

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type ChangeEvent = typeof changeEvents.$inferSelect;
export type NewChangeEvent = typeof changeEvents.$inferInsert;
export type ChangeType = ChangeEvent['changeType'];
export type Binding = typeof bindings.$inferSelect;
export type NewBinding = typeof bindings.$inferInsert;
export type BindingLayer = Binding['layer'];
export type BindingStatus = Binding['status'];
