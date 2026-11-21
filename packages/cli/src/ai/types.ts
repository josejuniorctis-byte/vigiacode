import type { LlmProvider } from '../config.js';

/** Mudança individual entregue ao resumo. */
export interface SummaryChange {
  filePath: string;
  changeType: 'add' | 'change' | 'unlink';
  layer: 'frontend' | 'backend' | 'database' | 'config' | 'other';
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
  /** Injetável nos testes; padrão: process.env. */
  env?: NodeJS.ProcessEnv | undefined;
  logger?: SummarizerLogger | undefined;
}
