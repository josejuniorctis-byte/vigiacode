/**
 * Barrel da camada de banco. Todo o resto da aplicação importa daqui — nunca de
 * better-sqlite3/drizzle diretamente.
 */
export { openDatabase } from './client.js';
export type {
  CodeAnchorDatabase,
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
  insertChangeEvents,
  insertSnapshot,
  listChangeEvents,
  listRecentChangeEvents,
  registerProject,
  resolveEventCursor,
  updateChangeEventSummary,
} from './repository.js';
export type {
  EventCursor,
  InsertChangeEventInput,
  InsertSnapshotInput,
  ListChangeEventsOptions,
  RegisterProjectInput,
} from './repository.js';
export {
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
  BindingLayer,
  BindingStatus,
  ChangeEvent,
  ChangeEventLayer,
  ChangeType,
  NewBinding,
  NewChangeEvent,
  NewProject,
  NewSnapshot,
  Project,
  Snapshot,
} from './schema.js';
