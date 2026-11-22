import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../config.js';
import { createBindingsScanner } from '../bindings/scanner.js';
import {
  applyMigrations,
  findProjectById,
  listBindings,
  migrationsFolder,
  openDatabase,
  type OpenedDatabase,
} from './index.js';

const FIXTURES = path.resolve(process.cwd(), 'test/fixtures');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function runSqlFile(opened: OpenedDatabase, file: string): void {
  const content = readFileSync(path.join(migrationsFolder(), file), 'utf8');
  for (const statement of content.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) opened.sqlite.exec(trimmed);
  }
}

function columnNames(opened: OpenedDatabase, table: string): string[] {
  return opened.sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => (column as { name: string }).name);
}

function indexNames(opened: OpenedDatabase, table: string): string[] {
  return opened.sqlite
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map((index) => (index as { name: string }).name);
}

function tableExists(opened: OpenedDatabase, table: string): boolean {
  const row = opened.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row?.name === table;
}

/** Monta um banco no esquema da Etapa 3 (migrations 0000 e 0001). */
function createLegacyDatabase(rootPath: string): OpenedDatabase {
  const opened = openDatabase(':memory:');
  runSqlFile(opened, '0000_init.sql');
  runSqlFile(opened, '0001_watcher.sql');

  // O migrator do Drizzle só considera pendentes as migrations com
  // `when` maior que o último `created_at` registrado.
  opened.sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  opened.sqlite
    .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run('manual-0001', 1795269766234);

  opened.sqlite
    .prepare('INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-project', 'legacy', rootPath, '2026-01-01T00:00:00.000Z');

  // Etapa 3 não tinha rule_id: a mesma identidade podia aparecer repetida.
  const insert = opened.sqlite.prepare(
    'INSERT INTO bindings (id, project_id, layer, entity, field, status, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insert.run(
    'legacy-1',
    'legacy-project',
    'backend',
    'user',
    'phone',
    'red',
    '2026-01-01T00:00:00.000Z',
  );
  insert.run(
    'legacy-2',
    'legacy-project',
    'backend',
    'user',
    'phone',
    'red',
    '2026-01-02T00:00:00.000Z',
  );
  insert.run(
    'legacy-3',
    'legacy-project',
    'backend',
    'user',
    'phone',
    'yellow',
    '2026-01-03T00:00:00.000Z',
  );
  insert.run(
    'legacy-4',
    'legacy-project',
    'frontend',
    'order',
    'total',
    'green',
    '2026-01-04T00:00:00.000Z',
  );

  return opened;
}

describe('migração de banco antigo (Etapa 3 → Etapa 5)', () => {
  it('deduplica bindings legados, repara timestamps e aplica 0003/0004 sem quebrar', () => {
    const root = tempDir('vigiacode-legacy-');
    cpSync(path.join(FIXTURES, 'react-fastify-drizzle'), root, { recursive: true });
    const opened = createLegacyDatabase(root);

    try {
      applyMigrations(opened.db);

      const phoneRows = opened.sqlite
        .prepare("SELECT * FROM bindings WHERE entity = 'user' AND field = 'phone'")
        .all() as Array<Record<string, unknown>>;
      expect(phoneRows).toHaveLength(1);
      expect(phoneRows[0]?.rule_id).toBe('GREEN');
      expect(phoneRows[0]?.first_seen_at).not.toBe('1970-01-01T00:00:00.000Z');
      expect(phoneRows[0]?.last_seen_at).not.toBe('1970-01-01T00:00:00.000Z');

      expect(indexNames(opened, 'bindings')).toContain('bindings_identity_idx');
      expect(indexNames(opened, 'binding_file_cache')).not.toContain(
        'binding_file_cache_project_idx',
      );
      expect(columnNames(opened, 'binding_scans')).toContain('coverage_json');
      expect(columnNames(opened, 'projects')).toContain('bindings_rescan_required');
      expect(tableExists(opened, 'roadmap_items')).toBe(true);
      expect(tableExists(opened, 'roadmap_links')).toBe(true);

      const project = findProjectById(opened.db, 'legacy-project');
      expect(project?.bindingsRescanRequired).toBe(true);
    } finally {
      opened.close();
    }
  });

  it('o rescan marcado pela migração repopula as amarrações e limpa a flag', async () => {
    const root = tempDir('vigiacode-legacy-scan-');
    cpSync(path.join(FIXTURES, 'react-fastify-drizzle'), root, { recursive: true });
    const opened = createLegacyDatabase(root);

    try {
      applyMigrations(opened.db);
      const project = findProjectById(opened.db, 'legacy-project');
      expect(project).toBeDefined();
      const config = createDefaultConfig({ name: 'legacy', rootPath: root });
      const scanner = createBindingsScanner({ db: opened.db, project: project!, config });

      const result = await scanner.scan({ trigger: 'start' });

      expect(result?.summary.red).toBe(4);
      const rows = listBindings(opened.db, 'legacy-project', { limit: 500 });
      expect(
        rows.some(
          (binding) =>
            binding.ruleId === 'R1' && binding.entity === 'user' && binding.field === 'phone',
        ),
      ).toBe(true);
      expect(findProjectById(opened.db, 'legacy-project')?.bindingsRescanRequired).toBe(false);
    } finally {
      opened.close();
    }
  });
});
