import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebouncedBatcher, type RawFileChange } from './batcher.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('DebouncedBatcher', () => {
  it('agrupa mudanças rápidas num único lote', async () => {
    vi.useFakeTimers();
    const batches: RawFileChange[][] = [];
    const batcher = new DebouncedBatcher({
      delayMs: 1500,
      onFlush: (changes) => {
        batches.push(changes);
      },
    });

    batcher.push({ path: 'src/b.ts', changeType: 'add' });
    batcher.push({ path: 'src/a.ts', changeType: 'change' });
    batcher.push({ path: 'src/a.ts', changeType: 'change' });
    batcher.push({ path: 'src/c.ts', changeType: 'unlink' });

    expect(batcher.pendingCount).toBe(3);

    await vi.advanceTimersByTimeAsync(1499);
    expect(batches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((change) => change.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('reinicia o debounce a cada nova mudança', async () => {
    vi.useFakeTimers();
    const batches: RawFileChange[][] = [];
    const batcher = new DebouncedBatcher({
      delayMs: 1000,
      onFlush: (changes) => {
        batches.push(changes);
      },
    });

    batcher.push({ path: 'src/a.ts', changeType: 'change' });
    await vi.advanceTimersByTimeAsync(800);
    batcher.push({ path: 'src/b.ts', changeType: 'change' });
    await vi.advanceTimersByTimeAsync(800);

    expect(batches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('flush manual entrega o lote e limpa o estado', async () => {
    const batches: RawFileChange[][] = [];
    const batcher = new DebouncedBatcher({
      delayMs: 60_000,
      onFlush: (changes) => {
        batches.push(changes);
      },
    });

    batcher.push({ path: 'src/a.ts', changeType: 'change' });
    await batcher.flush();

    expect(batches).toHaveLength(1);
    expect(batcher.pendingCount).toBe(0);
  });

  it('captura erro do handler sem rejeitar o flush', async () => {
    const errors: unknown[] = [];
    const batcher = new DebouncedBatcher({
      delayMs: 60_000,
      onFlush: () => {
        throw new Error('falhou');
      },
      onError: (error) => errors.push(error),
    });

    batcher.push({ path: 'src/a.ts', changeType: 'change' });
    await expect(batcher.flush()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
