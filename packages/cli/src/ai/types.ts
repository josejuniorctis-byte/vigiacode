import type { LlmProvider } from '../config.js';
import type { ChangeEventLayer, ChangeType } from '../db/schema.js';

/** Mudança individual entregue ao resumo. */
export interface SummaryChange {
  filePath: string;
  changeType: ChangeType;
  layer: ChangeEventLayer;
  diff: string;
}

/** Entrada do resumo: um lote de mudanças do vigia. */
export interface SummaryInput {
  projectName: string;
  changes: SummaryChange[];
}

export interface Summarizer {
  readonly provider: LlmProvider;
  summarize(input: SummaryInput): Promise<string>;
}

export interface SummarizerLogger {
  warn(message: string): void;
}

export interface SummarizerOptions {
  /** Injetável nos testes; padrão: fetch global do Node. */
  fetchImpl?: typeof fetch | undefined;
  logger?: SummarizerLogger | undefined;
}
