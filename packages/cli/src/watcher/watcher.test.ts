import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../config.js';
import { startWatcher } from './watcher.js';
import type { RawFileChange } from './batcher.js';

const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeanchor-watch-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  return dir;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await delay(25);
  }
  if (!predicate()) throw new Error('timeout aguardando condição');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('startWatcher', () => {
  it('agrupa mudanças rápidas num lote e ignora node_modules', async () => {
    const projectRoot = makeProject();
    const config = createDefaultConfig({ name: 'demo', rootPath: projectRoot });
    config.watch = {
      ...config.watch,
      paths: ['src'],
      debounceMs: 500,
      maxFileSizeKb: 500,
    };

    const batches: RawFileChange[][] = [];
    const errors: unknown[] = [];
    const watcher = await startWatcher({
      projectRoot,
      config: config.watch,
      onBatch: (changes) => {
        batches.push(changes);
      },
      onError: (error) => errors.push(error),
    });

    try {
      writeFileSync(path.join(projectRoot, 'src', 'a.ts'), 'const a = 1;\n', 'utf8');
      writeFileSync(path.join(projectRoot, 'src', 'b.ts'), 'const b = 2;\n', 'utf8');
      writeFileSync(path.join(projectRoot, 'src', 'c.ts'), 'const c = 3;\n', 'utf8');
      writeFileSync(path.join(projectRoot, 'node_modules', 'ignorado.ts'), 'x', 'utf8');

      await waitFor(() => batches.length >= 1);
      await delay(700);

      expect(errors).toHaveLength(0);
      expect(batches).toHaveLength(1);
      expect(batches[0]?.map((change) => change.path).sort()).toEqual([
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
      ]);
    } finally {
      await watcher.close();
    }
  });

  it('captura change e unlink', async () => {
    const projectRoot = makeProject();
    const config = createDefaultConfig({ name: 'demo', rootPath: projectRoot });
    config.watch = { ...config.watch, paths: ['src'], debounceMs: 300 };

    const filePath = path.join(projectRoot, 'src', 'a.ts');
    writeFileSync(filePath, 'const a = 1;\n', 'utf8');

    const batches: RawFileChange[][] = [];
    const watcher = await startWatcher({
      projectRoot,
      config: config.watch,
      onBatch: (changes) => {
        batches.push(changes);
      },
    });

    try {
      writeFileSync(filePath, 'const a = 2;\n', 'utf8');
      await waitFor(() => batches.length >= 1);
      expect(batches[0]?.[0]).toEqual({ path: 'src/a.ts', changeType: 'change' });

      rmSync(filePath);
      await waitFor(() => batches.length >= 2);
      expect(batches[1]?.[0]).toEqual({ path: 'src/a.ts', changeType: 'unlink' });
    } finally {
      await watcher.close();
    }
  });
});
