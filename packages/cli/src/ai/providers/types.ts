import type { LlmProvider } from '../../config.js';

export interface CompletionOptions {
  /** Instrução de sistema (quando o provider suportar). */
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Interface única usada pelo Summarizer, `ai test` e health check. */
export interface LLMProvider {
  readonly name: LlmProvider;
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
  healthCheck(): Promise<boolean>;
}

export interface ProviderRuntimeOptions {
  /** Injetável nos testes; padrão fetch global. */
  fetchImpl?: typeof fetch;
  /** Injetável nos testes; padrão process.env. */
  env?: NodeJS.ProcessEnv;
}

/** Configuração já resolvida (model/base_url/timeout/tokens/temperatura). */
export interface ProviderSettings {
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}
