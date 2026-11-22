import { randomUUID } from 'node:crypto';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/*
 * Schema inicial do VigiaCode (SQLite).
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
    /**
     * Marca que o próximo scan deve ser completo (cache de extração inválido).
     * A migration que corrige dados legados liga este flag em todos os projetos.
     */
    bindingsRescanRequired: integer('bindings_rescan_required', { mode: 'boolean' })
      .notNull()
      .default(false),
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
    /** Regra que originou a amarração (R1..R10) ou "GREEN". */
    ruleId: text('rule_id').notNull().default('GREEN'),
    /** Severidade final, já considerando a config (red/yellow/green). */
    severity: text('severity', { enum: ['red', 'yellow', 'green'] })
      .notNull()
      .default('green'),
    message: text('message').notNull().default(''),
    frontRef: text('front_ref'),
    backRef: text('back_ref'),
    dbRef: text('db_ref'),
    suggestion: text('suggestion'),
    // Defaults SQL servem para evoluir bancos existentes; a aplicação sempre
    // grava o timestamp ISO atual.
    firstSeenAt: text('first_seen_at').notNull().default('1970-01-01T00:00:00.000Z'),
    lastSeenAt: text('last_seen_at').notNull().default('1970-01-01T00:00:00.000Z'),
    resolvedAt: text('resolved_at'),
    accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('bindings_project_id_idx').on(table.projectId),
    index('bindings_project_layer_idx').on(table.projectId, table.layer),
    index('bindings_project_status_idx').on(table.projectId, table.status),
    index('bindings_project_rule_idx').on(table.projectId, table.ruleId),
    index('bindings_project_entity_idx').on(table.projectId, table.entity),
    index('bindings_project_resolved_idx').on(table.projectId, table.resolvedAt),
    uniqueIndex('bindings_identity_idx').on(
      table.projectId,
      table.ruleId,
      table.layer,
      table.entity,
      table.field,
    ),
  ],
);

/** Cada execução do detector (completa, no start, ou incremental pelo vigia). */
export const bindingScans = sqliteTable(
  'binding_scans',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    startedAt: text('started_at').notNull().$defaultFn(nowIso),
    finishedAt: text('finished_at'),
    filesScanned: integer('files_scanned').notNull().default(0),
    redCount: integer('red_count').notNull().default(0),
    yellowCount: integer('yellow_count').notNull().default(0),
    greenCount: integer('green_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    resolvedCount: integer('resolved_count').notNull().default(0),
    trigger: text('trigger', { enum: ['manual', 'watch', 'start'] })
      .notNull()
      .default('manual'),
    batchId: text('batch_id'),
    /** Matriz entidade × camadas congelada neste scan (JSON). */
    matrixJson: text('matrix_json'),
    /** Cobertura por regra: avaliáveis × ignoradas + contagens (JSON). */
    coverageJson: text('coverage_json'),
    error: text('error'),
  },
  (table) => [
    index('binding_scans_project_idx').on(table.projectId, table.startedAt),
    index('binding_scans_batch_idx').on(table.batchId),
  ],
);

/** Cache de extração por arquivo (hash do conteúdo) para scans incrementais. */
export const bindingFileCache = sqliteTable(
  'binding_file_cache',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    hash: text('hash').notNull(),
    layer: text('layer', { enum: ['frontend', 'backend', 'database'] }).notNull(),
    extractor: text('extractor').notNull(),
    data: text('data').notNull(),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
  },
  (table) => [uniqueIndex('binding_file_cache_path_idx').on(table.projectId, table.filePath)],
);

export const ROADMAP_KINDS = ['feature', 'fix', 'debt', 'binding', 'test', 'doc'] as const;
export type RoadmapKind = (typeof ROADMAP_KINDS)[number];

export const ROADMAP_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export const ROADMAP_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export type RoadmapPriority = (typeof ROADMAP_PRIORITIES)[number];

export const ROADMAP_SOURCES = ['manual', 'binding', 'git', 'ai', 'todo-comment'] as const;
export type RoadmapSource = (typeof ROADMAP_SOURCES)[number];

/**
 * Item do roadmap vivo gerado pelo Arquiteto (Etapa 5).
 *
 * Itens manuais nunca são fechados nem apagados automaticamente; os gerados
 * carregam `source_ref` determinístico para permitir upsert e fechamento por
 * evidência (scan/commit).
 */
export const roadmapItems = sqliteTable(
  'roadmap_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    kind: text('kind', { enum: ROADMAP_KINDS }).notNull(),
    status: text('status', { enum: ROADMAP_STATUSES }).notNull().default('todo'),
    priority: text('priority', { enum: ROADMAP_PRIORITIES }).notNull().default('p2'),
    source: text('source', { enum: ROADMAP_SOURCES }).notNull().default('manual'),
    sourceRef: text('source_ref'),
    module: text('module'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
    doneAt: text('done_at'),
    /** Evidências verificáveis (referências arquivo:linha, scanId, commit). */
    evidenceJson: text('evidence_json'),
    /** Checklist de pronto: [{ label, done, evidence? }]. */
    checklistJson: text('checklist_json'),
  },
  (table) => [
    index('roadmap_items_project_idx').on(table.projectId),
    index('roadmap_items_project_status_idx').on(table.projectId, table.status),
    index('roadmap_items_project_priority_idx').on(table.projectId, table.priority),
    index('roadmap_items_project_kind_idx').on(table.projectId, table.kind),
    index('roadmap_items_project_module_idx').on(table.projectId, table.module),
    index('roadmap_items_source_lookup_idx').on(
      table.projectId,
      table.kind,
      table.source,
      table.sourceRef,
    ),
  ],
);

/** Vínculos de um item do roadmap com amarração, arquivo ou commit. */
export const roadmapLinks = sqliteTable(
  'roadmap_links',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    itemId: text('item_id')
      .notNull()
      .references(() => roadmapItems.id, { onDelete: 'cascade' }),
    bindingId: text('binding_id').references(() => bindings.id, { onDelete: 'set null' }),
    filePath: text('file_path'),
    commitSha: text('commit_sha'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  (table) => [
    index('roadmap_links_item_idx').on(table.itemId),
    index('roadmap_links_binding_idx').on(table.bindingId),
    index('roadmap_links_file_idx').on(table.filePath),
  ],
);

/** Alias mantido para quem preferir a nomenclatura de tabelas do Drizzle. */
export const schema = {
  projects,
  snapshots,
  changeEvents,
  bindings,
  bindingScans,
  bindingFileCache,
  roadmapItems,
  roadmapLinks,
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
export type BindingScan = typeof bindingScans.$inferSelect;
export type NewBindingScan = typeof bindingScans.$inferInsert;
export type BindingFileCache = typeof bindingFileCache.$inferSelect;
export type NewBindingFileCache = typeof bindingFileCache.$inferInsert;
export type RoadmapItem = typeof roadmapItems.$inferSelect;
export type NewRoadmapItem = typeof roadmapItems.$inferInsert;
export type RoadmapLink = typeof roadmapLinks.$inferSelect;
export type NewRoadmapLink = typeof roadmapLinks.$inferInsert;

export interface RoadmapChecklistEntry {
  label: string;
  done: boolean;
  evidence?: string | null;
}
