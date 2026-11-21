import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

/**
 * Camada de acesso ao SQLite.
 *
 * Nada fora de src/db/ importa better-sqlite3 ou o driver do Drizzle. Quando o
 * PostgreSQL entrar no roadmap, basta criar um client equivalente (schema.pg.ts +
 * repository.pg.ts) e trocar a implementação exposta em src/db/index.ts.
 */

export type CodeAnchorDatabase = BetterSQLite3Database<typeof schema>;
export type SqliteConnection = Database.Database;

export interface OpenDatabaseOptions {
  /** Abre em modo somente leitura (útil para inspeção e ferramentas futuras). */
  readonly?: boolean;
}

export interface OpenedDatabase {
  db: CodeAnchorDatabase;
  sqlite: SqliteConnection;
  file: string;
  close(): void;
}

export function openDatabase(file: string, options: OpenDatabaseOptions = {}): OpenedDatabase {
  const readonly = options.readonly ?? false;

  if (!readonly && file !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const sqlite = new Database(file, { readonly, fileMustExist: false });

  if (!readonly) {
    // WAL dá leitura concorrente enquanto o watcher (Etapa 2) grava.
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('busy_timeout = 5000');
  }
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  let closed = false;
  return {
    db,
    sqlite,
    file,
    close(): void {
      if (closed) return;
      closed = true;
      sqlite.close();
    },
  };
}
