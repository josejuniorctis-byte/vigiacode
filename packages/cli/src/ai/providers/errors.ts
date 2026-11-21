import type { LlmProvider } from '../../config.js';
import { MissingApiKeyError, apiKeyCandidates } from './keys.js';

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: LlmProvider,
    readonly status: number,
  ) {
    super(`HTTP ${status} ao chamar o provider "${provider}"`);
    this.name = 'ProviderHttpError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor(
    readonly provider: LlmProvider,
    readonly timeoutMs: number,
  ) {
    super(`Tempo esgotado (${timeoutMs} ms) ao chamar o provider "${provider}"`);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderNetworkError extends Error {
  constructor(
    readonly provider: LlmProvider,
    cause?: unknown,
  ) {
    super(`Não foi possível conectar ao provider "${provider}".`);
    this.name = 'ProviderNetworkError';
    this.cause = cause;
  }
}

export interface DescribeProviderOptions {
  /** Inclui dicas e exemplos de .env. */
  detailed?: boolean;
  baseUrl?: string | null;
}

/** Mensagem em português, sem nunca expor a chave ou headers de autenticação. */
export function describeProviderError(
  error: unknown,
  provider: LlmProvider,
  options: DescribeProviderOptions = {},
): string {
  if (error instanceof MissingApiKeyError) {
    return error.message;
  }

  if (error instanceof ProviderTimeoutError) {
    return (
      `Tempo esgotado ao chamar o provider "${provider}" (${error.timeoutMs} ms). ` +
      'Verifique a conexão e aumente "timeout" no config se necessário.'
    );
  }

  if (error instanceof ProviderHttpError) {
    switch (error.status) {
      case 401:
      case 403:
        return (
          `O provider "${provider}" recusou a autenticação (HTTP ${error.status}). ` +
          `Confira ${apiKeyCandidates(provider)[0] ?? 'a chave de API'} e se ela tem acesso ao modelo.`
        );
      case 404:
        return (
          `Modelo ou endpoint não encontrado no provider "${provider}" (HTTP 404). ` +
          'Confira "model" e "base_url" no config.'
        );
      case 429:
        return `O provider "${provider}" limitou as requisições (HTTP 429). Tente novamente em alguns instantes.`;
      default:
        if (error.status >= 500) {
          return `O provider "${provider}" respondeu HTTP ${error.status} (indisponibilidade temporária).`;
        }
        return `O provider "${provider}" respondeu HTTP ${error.status}.`;
    }
  }

  if (error instanceof ProviderNetworkError) {
    if (provider === 'ollama') {
      return (
        'Não foi possível conectar ao Ollama em ' +
        `${options.baseUrl ?? 'http://localhost:11434'}. ` +
        'Verifique se ele está rodando (ollama serve) e se o modelo foi baixado (ollama pull <modelo>).'
      );
    }
    return (
      `Não foi possível conectar ao provider "${provider}". ` +
      'Verifique sua internet e o "base_url" configurado.'
    );
  }

  if (error instanceof Error) {
    // Erros de configuração já vêm em português.
    if (error.name === 'ProviderConfigError') return error.message;
    return `Falha no provider "${provider}": ${error.message}`;
  }

  return `Falha desconhecida no provider "${provider}".`;
}
