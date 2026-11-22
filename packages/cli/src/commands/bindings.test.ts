import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig, resolveConfigPaths, writeConfig } from '../config.js';
import {
  applyMigrations,
  openDatabase,
  registerProject,
  type OpenedDatabase,
} from '../db/index.js';
import { applyExitCode, runBindingsList, runBindingsMatrix, runBindingsScan } from './bindings.js';

const FIXTURE = path.resolve(process.cwd(), 'test/fixtures/react-fastify-drizzle');
const tempDirs: string[] = [];
let opened: OpenedDatabase | null = null;

function initializeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'vigiacode-bindings-cli-'));
  tempDirs.push(root);
  cpSync(FIXTURE, root, { recursive: true });

  const config = createDefaultConfig({ name: 'cli-fixture', rootPath: root });
  writeConfig(root, config);
  const paths = resolveConfigPaths(root, config.database.file);
  opened = openDatabase(paths.databaseFile);
  applyMigrations(opened.db);
  registerProject(opened.db, { name: 'cli-fixture', rootPath: root });
  return root;
}

beforeEach(() => {
  process.exitCode = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  opened?.close();
  opened = null;
  vi.restoreAllMocks();
  process.exitCode = 0;
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('comandos bindings', () => {
  it('scan define exit code 1 com 🔴 e 0 com --fail-on none', async () => {
    const root = initializeProject();

    await runBindingsScan({ cwd: root, failOn: 'red' });
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    await runBindingsScan({ cwd: root, failOn: 'none' });
    expect(process.exitCode).toBe(0);
  });

  it('list respeita os filtros e matrix imprime a tabela', async () => {
    const root = initializeProject();
    await runBindingsScan({ cwd: root, failOn: 'none' });

    await runBindingsList({ cwd: root, status: 'red', layer: 'backend', limit: 10 });
    expect(process.exitCode).toBe(0);

    await runBindingsMatrix({ cwd: root });
    expect(process.exitCode).toBe(0);
  });

  it('applyExitCode entende red, yellow e none', () => {
    applyExitCode('red', 0, 3);
    expect(process.exitCode).toBe(0);

    applyExitCode('red', 1, 0);
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    applyExitCode('yellow', 0, 2);
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    applyExitCode('yellow', 0, 0);
    expect(process.exitCode).toBe(0);

    applyExitCode('none', 5, 5);
    expect(process.exitCode).toBe(0);
  });
});
