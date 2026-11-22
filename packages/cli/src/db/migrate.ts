import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { VigiaCodeDatabase } from './client.js';

/**
 * As migrations SQL são geradas pelo drizzle-kit em `packages/cli/drizzle/`.
 *
 * No monorepo (source), resolvemos `../../drizzle`; no pacote publicado, o
 * build copia as migrations para `dist/drizzle` e resolvemos `../drizzle`.
 */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.resolve(here, '../drizzle');
  if (existsSync(path.join(bundled, 'meta', '_journal.json'))) return bundled;
  return path.resolve(here, '../../drizzle');
}

export function hasMigrations(folder: string = migrationsFolder()): boolean {
  return existsSync(path.join(folder, 'meta', '_journal.json'));
}

/** Aplica todas as migrations pendentes. Idempotente. */
export function applyMigrations(db: VigiaCodeDatabase, folder: string = migrationsFolder()): void {
  if (!hasMigrations(folder)) {
    throw new Error(
      `Migrations não encontradas em ${folder}. Rode "pnpm --filter vigiacode db:generate" para gerá-las.`,
    );
  }

  // A 0002 cria o índice único de identidade. Bancos da Etapa 3 podem ter
  // bindings duplicados (a tabela não tinha rule_id); sem esta limpeza a
  // criação do índice falharia antes de a 0003 rodar. Amarrações são
  // recalculáveis, então manter o registro mais recente é seguro.
  dedupeLegacyBindings(db);

  migrate(db, { migrationsFolder: folder });
}

/** Remove duplicatas legadas antes da migração que cria o índice único. */
export function dedupeLegacyBindings(db: VigiaCodeDatabase): number {
  const table = db.get<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bindings'`,
  );
  if (!table) return 0;

  const columns = db.all<{ name: string }>(sql`PRAGMA table_info(bindings)`);
  const names = new Set(columns.map((column) => column.name));
  const identity = names.has('rule_id')
    ? 'project_id, rule_id, layer, entity, field'
    : 'project_id, layer, entity, field';

  const before = db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM bindings`)?.count ?? 0;
  db.run(
    sql.raw(
      `DELETE FROM bindings WHERE rowid NOT IN (SELECT MAX(rowid) FROM bindings GROUP BY ${identity})`,
    ),
  );
  const after = db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM bindings`)?.count ?? 0;
  return Math.max(0, before - after);
}
