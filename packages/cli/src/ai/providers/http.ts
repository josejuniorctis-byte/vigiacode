import type { LlmProvider } from '../../config.js';
import { ProviderHttpError, ProviderNetworkError, ProviderTimeoutError } from './errors.js';

export interface JsonRequestOptions {
  provider: LlmProvider;
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}

export async function requestJson(options: JsonRequestOptions): Promise<unknown> {
  if (typeof options.fetchImpl !== 'function') {
    throw new ProviderNetworkError(options.provider, new Error('fetch indisponível'));
  }

  let response: Response;
  try {
    response = await options.fetchImpl(options.url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ProviderTimeoutError(options.provider, options.timeoutMs);
    }
    throw new ProviderNetworkError(options.provider, error);
  }

  if (!response.ok) {
    throw new ProviderHttpError(options.provider, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('Resposta inválida (JSON) do provider.');
  }
}

export async function requestOk(options: JsonRequestOptions): Promise<void> {
  await requestJson(options);
}

export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}

/** Junta base + endpoint sem duplicar quando o base_url já inclui o endpoint. */
export function joinUrl(baseUrl: string, endpoint: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith(endpoint)) return base;
  return `${base}${endpoint}`;
}

export function anthropicMessagesUrl(baseUrl: string): string {
  return anthropicUrl(baseUrl, '/v1/messages');
}

export function anthropicModelsUrl(baseUrl: string): string {
  return anthropicUrl(baseUrl, '/v1/models');
}

function anthropicUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith(path)) return base;
  if (base.endsWith('/v1')) return `${base}${path.slice('/v1'.length)}`;
  return `${base}${path}`;
}

export function geminiGenerateUrl(baseUrl: string, model: string): string {
  const normalizedModel = model.startsWith('models/') ? model.slice('models/'.length) : model;
  return `${geminiApiBase(baseUrl)}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
}

export function geminiModelsUrl(baseUrl: string): string {
  return `${geminiApiBase(baseUrl)}/models`;
}

function geminiApiBase(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/v1beta')) return base;
  return `${base}/v1beta`;
}
