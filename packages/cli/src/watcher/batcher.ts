import type { ChangeType } from '../db/schema.js';

export interface RawFileChange {
  /** Caminho relativo à raiz do projeto, em formato POSIX. */
  path: string;
  changeType: ChangeType;
}

export interface DebouncedBatcherOptions {
  delayMs: number;
  onFlush: (changes: RawFileChange[]) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

/**
 * Agrupa mudanças rápidas num lote. Cada caminho aparece uma vez; o último
 * evento vence (ex.: add seguido de change vira só change).
 */
export class DebouncedBatcher {
  private readonly pending = new Map<string, RawFileChange>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Serializa lotes para não abrir duas gravações concorrentes no shutdown. */
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly options: DebouncedBatcherOptions) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  push(change: RawFileChange): void {
    this.pending.set(change.path, change);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delayMs);
    this.timer.unref?.();
  }

  /** Dispara o lote imediatamente (usado no shutdown e nos testes). */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pending.size === 0) return;

    const changes = [...this.pending.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    this.pending.clear();

    this.running = this.running.then(async () => {
      try {
        await this.options.onFlush(changes);
      } catch (error) {
        this.options.onError?.(error);
      }
    });

    await this.running;
  }

  /** Flush final, aguardando o lote em andamento. */
  async close(): Promise<void> {
    await this.flush();
    await this.running;
  }
}
