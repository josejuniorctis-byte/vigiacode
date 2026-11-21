import { existsSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { WatchConfig } from '../config.js';
import {
  createIgnoreMatcher,
  isBinaryPath,
  normalizeRelativePath,
  type IgnoreMatcher,
} from './ignore.js';
import { DebouncedBatcher } from './batcher.js';
import type { RawFileChange } from './batcher.js';

export interface StartWatcherOptions {
  projectRoot: string;
  config: WatchConfig;
  onBatch: (changes: RawFileChange[]) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

export interface WatcherHandle {
  readonly paths: string[];
  readonly matcher: IgnoreMatcher;
  readonly batcher: DebouncedBatcher;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Vigia o projeto com chokidar, aplica ignores e agrupa mudanças com debounce.
 * O watcher só entrega o lote; gravação/diff/resumo ficam no recorder.
 */
export async function startWatcher(options: StartWatcherOptions): Promise<WatcherHandle> {
  const { projectRoot, config } = options;
  const matcher = createIgnoreMatcher(projectRoot, config);
  const maxBytes = Math.max(1, config.maxFileSizeKb) * 1024;

  const batcher = new DebouncedBatcher({
    delayMs: Math.max(50, config.debounceMs),
    onFlush: options.onBatch,
    onError: options.onError,
  });

  const watchPaths = resolveWatchPaths(projectRoot, config.paths);
  const watcher = watch(watchPaths, {
    ignored: (candidate: string, stats?: Stats) => {
      const relative = toRelativePath(projectRoot, candidate);
      if (relative === null) return true;
      if (relative === '') return false;
      if (matcher.ignores(relative, stats?.isDirectory() ?? false)) return true;
      if (stats?.isFile()) {
        if (isBinaryPath(relative)) return true;
        if (stats.size > maxBytes) return true;
      }
      return false;
    },
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    alwaysStat: true,
    atomic: true,
    awaitWriteFinish: false,
  });

  const handleEvent = (event: string, filePath: string): void => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;

    const relative = toRelativePath(projectRoot, filePath);
    if (relative === null || relative === '') return;
    if (matcher.ignores(relative)) return;

    if (event === 'unlink') {
      batcher.push({ path: relative, changeType: 'unlink' });
      return;
    }

    void stat(path.resolve(projectRoot, relative))
      .then((fileStats) => {
        if (fileStats.size > maxBytes) return;
        if (isBinaryPath(relative)) return;
        batcher.push({
          path: relative,
          changeType: event === 'add' ? 'add' : 'change',
        });
      })
      .catch(() => {
        // Arquivo removido entre o evento e o stat: ignora.
      });
  };

  watcher.on('all', handleEvent);
  watcher.on('error', (error: unknown) => {
    options.onError?.(error);
  });

  try {
    await waitForReady(watcher);
  } catch (error) {
    await watcher.close();
    throw error;
  }

  return {
    paths: watchPaths,
    matcher,
    batcher,
    async flush(): Promise<void> {
      await batcher.flush();
    },
    async close(): Promise<void> {
      await batcher.close();
      await watcher.close();
    },
  };
}

/** Caminhos configurados que existem; se nenhum existir, observa a raiz. */
export function resolveWatchPaths(projectRoot: string, configuredPaths: string[]): string[] {
  const resolved = configuredPaths
    .map((configured) => path.resolve(projectRoot, configured))
    .filter((candidate) => existsSync(candidate));

  return resolved.length > 0 ? resolved : [projectRoot];
}

/** Caminho relativo POSIX ou null quando está fora da raiz. */
export function toRelativePath(projectRoot: string, candidate: string): string | null {
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate);
  const relative = path.relative(projectRoot, absolute);
  if (relative === '') return '';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return normalizeRelativePath(relative);
}

function waitForReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('tempo esgotado ao iniciar o vigia'));
    }, 15_000);
    timeout.unref?.();

    const onReady = (): void => {
      clearTimeout(timeout);
      cleanup();
      resolve();
    };
    const onError = (error: unknown): void => {
      clearTimeout(timeout);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = (): void => {
      watcher.off('ready', onReady);
      watcher.off('error', onError);
    };

    watcher.once('ready', onReady);
    watcher.once('error', onError);
  });
}
