/**
 * Barrel da camada de banco. Todo o resto da aplicação importa daqui — nunca de
 * better-sqlite3/drizzle diretamente.
 */
export { openDatabase } from './client.js';
export type {
  VigiaCodeDatabase,
  OpenDatabaseOptions,
  OpenedDatabase,
  SqliteConnection,
} from './client.js';
export { applyMigrations, hasMigrations, migrationsFolder } from './migrate.js';
export {
  clampLimit,
  countChangeEvents,
  findChangeEventById,
  findProjectById,
  findProjectByRootPath,
  getLatestSnapshot,
  getProjectStats,
  insertChangeEvents,
  insertSnapshot,
  listChangeEvents,
  listFileEvents,
  listRecentChangeEvents,
  listSnapshots,
  registerProject,
  resolveEventCursor,
  updateChangeEventSummary,
} from './repository.js';
export type {
  EventCursor,
  InsertChangeEventInput,
  InsertSnapshotInput,
  ListChangeEventsOptions,
  ProjectStats,
  RegisterProjectInput,
  StatsDay,
  StatsFile,
} from './repository.js';
export {
  acceptBinding,
  bindingIdentityKey,
  clampBindingLimit,
  clearBindingFileCache,
  deleteBindingFileCache,
  findBindingById,
  finishBindingScan,
  getLatestBindingScan,
  insertBindingScan,
  listBindingFileCache,
  listBindingScans,
  listBindings,
  putBindingFileCache,
  resolveBindingsNotSeen,
  summarizeBindings,
  upsertBinding,
} from './bindings-repository.js';
export type {
  BindingLayerCount,
  BindingRuleCount,
  BindingSummary,
  FinishBindingScanInput,
  InsertBindingScanInput,
  ListBindingsOptions,
  PutBindingFileCacheInput,
  UpsertBindingInput,
  UpsertBindingResult,
} from './bindings-repository.js';
export {
  bindingFileCache,
  bindingScans,
  bindings,
  changeEvents,
  isChangeEventLayer,
  projects,
  schema,
  snapshots,
  CHANGE_EVENT_LAYERS,
} from './schema.js';
export type {
  Binding,
  BindingFileCache,
  BindingLayer,
  BindingScan,
  BindingStatus,
  ChangeEvent,
  ChangeEventLayer,
  ChangeType,
  NewBinding,
  NewBindingFileCache,
  NewBindingScan,
  NewChangeEvent,
  NewProject,
  NewSnapshot,
  Project,
  Snapshot,
} from './schema.js';
