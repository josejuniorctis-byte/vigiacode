export interface SummaryQueueOptions {
  onError?: (error: unknown) => void;
}

/**
 * Fila serial (concorrência 1) para os resumos de IA. O watcher grava os eventos
 * na hora e enfileira o resumo, sem bloquear o processamento do próximo lote.
 */
export class SummaryQueue {
  private tail: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  constructor(private readonly options: SummaryQueueOptions = {}) {}

  get pending(): number {
    return this.pendingCount;
  }

  enqueue(task: () => Promise<void>): void {
    this.pendingCount += 1;
    this.tail = this.tail
      .then(task)
      .catch((error: unknown) => {
        this.options.onError?.(error);
      })
      .finally(() => {
        this.pendingCount -= 1;
      });
  }

  /** Espera a fila esvaziar (com timeout para não prender o Ctrl+C). */
  async drain(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pendingCount > 0 && Date.now() < deadline) {
      await delay(20);
    }
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
