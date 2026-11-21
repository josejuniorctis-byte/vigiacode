import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { CodeAnchorDatabase } from './client.js';

/**
 * As migrations SQL são geradas pelo drizzle-kit em `packages/cli/drizzle/`.
 *
 * O caminho é resolvido a partir deste arquivo, então funciona tanto rodando do
 * source (src/db/migrate.ts → "../../drizzle") quanto do build
 * (dist/db/migrate.js → "../../drizzle").
 */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../drizzle');
}

export function hasMigrations(folder: string = migrationsFolder()): boolean {
  return existsSync(path.join(folder, 'meta', '_journal.json'));
}

/** Aplica todas as migrations pendentes. Idempotente. */
export function applyMigrations(db: CodeAnchorDatabase, folder: string = migrationsFolder()): void {
  if (!hasMigrations(folder)) {
    throw new Error(
      `Migrations não encontradas em ${folder}. Rode "pnpm --filter codeanchor db:generate" para gerá-las.`,
    );
  }

  migrate(db, { migrationsFolder: folder });
}
