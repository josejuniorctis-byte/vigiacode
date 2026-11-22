import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

/**
 * Camada de acesso ao SQLite.
 *
 * Nada fora de src/db/ importa better-sqlite3 ou o driver do Drizzle. Quando o
 * PostgreSQL entrar no roadmap, basta criar um client equivalente (schema.pg.ts +
 * repository.pg.ts) e trocar a implementação exposta em src/db/index.ts.
 */

type DatabaseConstructor = typeof BetterSqlite3;

let cachedDatabase: DatabaseConstructor | null = null;

/**
 * Carrega better-sqlite3 sob demanda: se o binário nativo não existir, o erro
 * aparece como mensagem amigável em vez de stack de ERR_DLOPEN_FAILED na
 * importação do módulo.
 */
function loadBetterSqlite3(): DatabaseConstructor {
  if (cachedDatabase) return cachedDatabase;
  try {
    const require = createRequire(import.meta.url);
    cachedDatabase = require('better-sqlite3') as DatabaseConstructor;
    return cachedDatabase;
  } catch (error) {
    throw nativeModuleError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Em algumas versões o bindings só é resolvido ao instanciar o Database, então
 * a criação também precisa traduzir a falha do binário.
 */
function createSqlite(
  Database: DatabaseConstructor,
  file: string,
  options: { readonly: boolean },
): SqliteConnection {
  try {
    return new Database(file, { readonly: options.readonly, fileMustExist: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/bindings file|ERR_DLOPEN|better_sqlite3/i.test(detail)) {
      throw nativeModuleError(detail);
    }
    throw error;
  }
}

function nativeModuleError(detail: string): Error {
  return new Error(
    [
      'Não foi possível carregar o módulo nativo better-sqlite3.',
      '',
      `Detalhe: ${detail}`,
      '',
      'O better-sqlite3 usa um binário compilado para a sua plataforma. Requisitos:',
      '  • Windows: Node 20/22 e Visual Studio Build Tools (C++ Desktop) + Python 3.',
      '  • macOS:   Xcode Command Line Tools (xcode-select --install).',
      '  • Linux:   build-essential, python3 e make (imagem node:20-slim precisa instalá-los).',
      '  • Node muito novo (ex.: 26) pode ainda não ter binário pré-compilado.',
      '',
      'Tente reinstalar o pacote com: npm rebuild better-sqlite3',
      'Se o problema continuar, use Node 20 ou 22 (versões suportadas pelo pacote).',
    ].join('\n'),
  );
}

export type VigiaCodeDatabase = BetterSQLite3Database<typeof schema>;
export type SqliteConnection = BetterSqlite3.Database;

export interface OpenDatabaseOptions {
  /** Abre em modo somente leitura (útil para inspeção e ferramentas futuras). */
  readonly?: boolean;
}

export interface OpenedDatabase {
  db: VigiaCodeDatabase;
  sqlite: SqliteConnection;
  file: string;
  close(): void;
}

export function openDatabase(file: string, options: OpenDatabaseOptions = {}): OpenedDatabase {
  const readonly = options.readonly ?? false;

  if (!readonly && file !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const Database = loadBetterSqlite3();
  const sqlite = createSqlite(Database, file, { readonly });

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
