import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../config.js';
import {
  applyMigrations,
  listBindingFileCache,
  listBindings,
  openDatabase,
  registerProject,
  type OpenedDatabase,
} from '../db/index.js';
import { createBindingsScanner, type BindingsScanner } from './scanner.js';
import type { BindingsStreamMessage } from './types.js';
import { createDefaultBindingsConfig } from '../config.js';

const FIXTURES = path.resolve(process.cwd(), 'test/fixtures');
const tempDirs: string[] = [];

function fixturePath(name: string): string {
  return path.join(FIXTURES, name);
}

function copyFixture(name: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'vigiacode-bindings-'));
  tempDirs.push(directory);
  cpSync(fixturePath(name), directory, { recursive: true });
  return directory;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

interface ScanFixtureResult {
  opened: OpenedDatabase;
  scanner: BindingsScanner;
  result: Awaited<ReturnType<BindingsScanner['scan']>>;
  projectId: string;
}

async function scanFixture(name: string, root = fixturePath(name)): Promise<ScanFixtureResult> {
  const opened = openDatabase(':memory:');
  applyMigrations(opened.db);
  const project = registerProject(opened.db, { name, rootPath: root });
  const config = createDefaultConfig({ name, rootPath: root });
  const scanner = createBindingsScanner({ db: opened.db, project, config });
  const result = await scanner.scan({ trigger: 'manual' });
  return { opened, scanner, result, projectId: project.id };
}

function signatures(opened: OpenedDatabase, projectId: string): string[] {
  return listBindings(opened.db, projectId, { limit: 500 })
    .map((binding) => `${binding.ruleId}:${binding.layer}:${binding.entity}:${binding.field}`)
    .sort();
}

function activeSignatures(opened: OpenedDatabase, projectId: string): string[] {
  return signatures(opened, projectId).filter((signature) => !signature.startsWith('GREEN:'));
}

describe('scan das fixtures', () => {
  it('React + Fastify + Drizzle aponta exatamente as quebras plantadas', async () => {
    const { opened, result, projectId } = await scanFixture('react-fastify-drizzle');

    try {
      expect(activeSignatures(opened, projectId)).toEqual([
        'R1:backend:user:phone',
        'R2:database:user:age',
        'R2:database:user:nickname',
        'R3:database:user:legacy_code',
        'R3:database:user:obsolete',
        'R4:frontend:order:GET /api/orders',
        'R5:backend:customer:GET /api/customers',
        'R6:frontend:customer:*',
        'R7:frontend:missing_panel:../components/MissingPanel',
        'R8:frontend:user:full_name',
      ]);

      expect(
        signatures(opened, projectId).filter((signature) => signature.startsWith('GREEN:')),
      ).toEqual([
        'GREEN:backend:user:email',
        'GREEN:backend:user:id',
        'GREEN:backend:user:name',
        'GREEN:backend:user:role',
      ]);

      expect(result?.summary).toMatchObject({ red: 4, yellow: 6, green: 4, healthPercent: 29 });
      expect(result?.matrix.entities.find((row) => row.entity === 'customer')?.link).toBe('local');
      expect(result?.matrix.entities.find((row) => row.entity === 'user')?.link).toBe('partial');
    } finally {
      opened.close();
    }
  });

  it('React + Spring Boot + Flyway aponta exatamente as quebras plantadas', async () => {
    const { opened, result, projectId } = await scanFixture('react-spring-flyway');

    try {
      expect(activeSignatures(opened, projectId)).toEqual([
        'R1:backend:product:sku',
        'R2:database:product:description',
        'R2:database:product:price',
        'R3:database:product:legacy',
        'R3:database:product:stock',
        'R4:frontend:category:GET /api/categories',
        'R5:backend:product:GET /api/products/:param',
        'R8:frontend:product:display_name',
      ]);

      expect(
        signatures(opened, projectId).filter((signature) => signature.startsWith('GREEN:')),
      ).toEqual(['GREEN:backend:product:id', 'GREEN:backend:product:name']);
      expect(result?.summary).toMatchObject({ red: 3, yellow: 5, green: 2 });
    } finally {
      opened.close();
    }
  });

  it('Next.js + Prisma aponta exatamente as quebras plantadas', async () => {
    const { opened, result, projectId } = await scanFixture('next-prisma');

    try {
      expect(activeSignatures(opened, projectId)).toEqual([
        'R1:backend:user:phone',
        'R2:database:user:nickname',
        'R3:database:user:legacy_code',
        'R3:database:user:obsolete',
        'R4:frontend:checkout:POST /api/checkout',
        'R5:backend:order:GET /api/orders',
        'R6:frontend:order:*',
        'R7:frontend:user:./UserForm',
      ]);

      expect(
        signatures(opened, projectId).filter((signature) => signature.startsWith('GREEN:')),
      ).toEqual([
        'GREEN:backend:user:email',
        'GREEN:backend:user:id',
        'GREEN:backend:user:name',
        'GREEN:backend:user:role',
      ]);
      expect(result?.summary).toMatchObject({ red: 4, yellow: 4, green: 4 });
      expect(result?.matrix.entities.find((row) => row.entity === 'order')?.link).toBe('missing');
    } finally {
      opened.close();
    }
  });
});

describe('scan incremental e resolução', () => {
  it('adiciona um campo no front, detecta R1 e resolve quando o campo chega ao DTO, schema e migration', async () => {
    const root = copyFixture('react-fastify-drizzle');
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name: 'incremental', rootPath: root });
    const config = createDefaultConfig({ name: 'incremental', rootPath: root });
    const messages: BindingsStreamMessage[] = [];
    const scanner = createBindingsScanner({
      db: opened.db,
      project,
      config,
      hub: { publish: (message) => messages.push(message) },
    });

    try {
      await scanner.scan({ trigger: 'start' });
      expect(listBindingFileCache(opened.db, project.id)).toHaveLength(9);

      // 1) Adiciona o campo no front-end, sem backend.
      const pagePath = path.join(root, 'src/pages/UsersPage.tsx');
      const typesPath = path.join(root, 'src/types/user.ts');
      writeFileSync(
        pagePath,
        readFileSync(pagePath, 'utf8').replace(
          '</form>',
          '  <input name="whatsapp" />\n    </form>',
        ),
        'utf8',
      );
      writeFileSync(
        typesPath,
        readFileSync(typesPath, 'utf8').replace(
          '  fullName: string;',
          '  fullName: string;\n  whatsapp: string;',
        ),
        'utf8',
      );

      const incremental = await scanner.scan({
        trigger: 'watch',
        batchId: 'lote-front',
        changedFiles: ['src/pages/UsersPage.tsx', 'src/types/user.ts'],
      });

      expect(incremental?.batchId).toBe('lote-front');
      expect(
        listBindings(opened.db, project.id, { limit: 500 }).find(
          (binding) => binding.ruleId === 'R1' && binding.field === 'whatsapp',
        ),
      ).toMatchObject({ status: 'red', resolvedAt: null });

      expect(messages.at(-1)).toMatchObject({
        type: 'bindings',
        trigger: 'watch',
        batchId: 'lote-front',
        counts: expect.objectContaining({ red: expect.any(Number) }),
      });

      // 2) Cria o campo no DTO, no schema e numa migration nova.
      const dtoPath = path.join(root, 'server/routes/users.ts');
      writeFileSync(
        dtoPath,
        readFileSync(dtoPath, 'utf8').replace(
          '  displayName: string;',
          '  displayName: string;\n  whatsapp: string;',
        ),
        'utf8',
      );
      const schemaPath = path.join(root, 'db/schema.ts');
      writeFileSync(
        schemaPath,
        readFileSync(schemaPath, 'utf8').replace(
          "  price: real('price'),",
          "  price: real('price'),\n  whatsapp: text('whatsapp'),",
        ),
        'utf8',
      );
      const migrationPath = path.join(root, 'db/migrations/0001_whatsapp.sql');
      writeFileSync(migrationPath, 'ALTER TABLE users ADD COLUMN whatsapp TEXT;\n', 'utf8');

      const resolved = await scanner.scan({
        trigger: 'watch',
        batchId: 'lote-back',
        changedFiles: ['server/routes/users.ts', 'db/schema.ts', 'db/migrations/0001_whatsapp.sql'],
      });

      const all = listBindings(opened.db, project.id, {
        limit: 500,
        includeResolved: true,
      });
      expect(
        all.find((binding) => binding.ruleId === 'R1' && binding.field === 'whatsapp')?.resolvedAt,
      ).not.toBeNull();
      expect(
        all.find((binding) => binding.ruleId === 'GREEN' && binding.field === 'whatsapp'),
      ).toMatchObject({ status: 'green', resolvedAt: null });
      expect(resolved?.resolved.some((binding) => binding.ruleId === 'R1')).toBe(true);
      expect(resolved?.created.some((binding) => binding.ruleId === 'GREEN')).toBe(true);
      expect(messages.at(-1)?.counts.green).toBeGreaterThanOrEqual(5);
    } finally {
      opened.close();
    }
  });

  it('não reparseia arquivos sem mudança e mantém as contagens estáveis', async () => {
    const root = copyFixture('react-fastify-drizzle');
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name: 'cache', rootPath: root });
    const config = createDefaultConfig({ name: 'cache', rootPath: root });
    const scanner = createBindingsScanner({ db: opened.db, project, config });

    try {
      const first = await scanner.scan({ trigger: 'manual' });
      const cacheSize = listBindingFileCache(opened.db, project.id).length;

      const second = await scanner.scan({ trigger: 'manual' });

      expect(first?.summary).toMatchObject({
        red: second?.summary.red,
        yellow: second?.summary.yellow,
        green: second?.summary.green,
      });
      expect(second?.created).toHaveLength(0);
      expect(second?.resolved).toHaveLength(0);
      expect(listBindingFileCache(opened.db, project.id)).toHaveLength(cacheSize);
    } finally {
      opened.close();
    }
  });

  it('respeita bindings.ignore ao caminhar o projeto', async () => {
    const root = copyFixture('react-fastify-drizzle');
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name: 'ignore', rootPath: root });
    const config = createDefaultConfig({ name: 'ignore', rootPath: root });
    config.bindings.ignore.push('src/pages/**');

    const scanner = createBindingsScanner({ db: opened.db, project, config });
    try {
      await scanner.scan({ trigger: 'manual' });
      const rows = listBindings(opened.db, project.id, { limit: 500 });
      expect(rows.some((binding) => binding.ruleId === 'R4')).toBe(false);
      expect(rows.some((binding) => binding.ruleId === 'R7')).toBe(false);
    } finally {
      opened.close();
    }
  });

  it('mantém extrações de front e back do mesmo arquivo no cache', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vigiacode-multilayer-'));
    tempDirs.push(root);
    mkdirSync(path.join(root, 'api'), { recursive: true });
    writeFileSync(
      path.join(root, 'api/handlers.ts'),
      [
        "import { NextResponse } from 'next/server';",
        '',
        'export async function GET() {',
        "  const upstream = await fetch('http://localhost:3000/api/orders');",
        '  return NextResponse.json(await upstream.json());',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name: 'multilayer', rootPath: root });
    const config = createDefaultConfig({ name: 'multilayer', rootPath: root });
    const scanner = createBindingsScanner({ db: opened.db, project, config });

    const layersOfCache = (): string[] => {
      const rows = listBindingFileCache(opened.db, project.id);
      return rows.flatMap((row) =>
        (JSON.parse(row.data) as Array<{ layer: string }>).map((extract) => extract.layer),
      );
    };

    try {
      await scanner.scan({ trigger: 'manual' });
      const rows = listBindingFileCache(opened.db, project.id);
      expect(rows).toHaveLength(1);
      expect(layersOfCache().sort()).toEqual(['backend', 'frontend']);

      // Sem mudança no arquivo o cache é reaproveitado sem perder nenhuma camada.
      await scanner.scan({ trigger: 'manual' });
      expect(listBindingFileCache(opened.db, project.id)).toHaveLength(1);
      expect(layersOfCache().sort()).toEqual(['backend', 'frontend']);
    } finally {
      opened.close();
    }
  });

  it('respeita falsos positivos aceitos no config', async () => {
    const root = copyFixture('react-fastify-drizzle');
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name: 'accepted', rootPath: root });
    const config = createDefaultConfig({ name: 'accepted', rootPath: root });
    config.bindings = createDefaultBindingsConfig();
    config.bindings.acceptedFalsePositives.push('R1:user:phone');

    const scanner = createBindingsScanner({ db: opened.db, project, config });
    try {
      await scanner.scan({ trigger: 'manual' });
      expect(
        listBindings(opened.db, project.id, { limit: 500 }).some(
          (binding) => binding.ruleId === 'R1' && binding.field === 'phone',
        ),
      ).toBe(false);
    } finally {
      opened.close();
    }
  });
});
