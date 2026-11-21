import { joinUrl, requestJson, requestOk } from './http.js';
import type { CompletionOptions, LLMProvider, ProviderSettings } from './types.js';

/** Ollama local em /api/chat (sem chave de API). */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;

  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const model = options.model ?? this.settings.model;
    const messages: Array<{ role: string; content: string }> = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });

    const data = await requestJson({
      provider: 'ollama',
      fetchImpl: this.fetchImpl,
      url: joinUrl(this.settings.baseUrl, '/api/chat'),
      method: 'POST',
      timeoutMs: options.timeoutMs ?? this.settings.timeoutMs,
      body: {
        model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? this.settings.temperature,
          num_predict: options.maxTokens ?? this.settings.maxTokens,
        },
      },
    });

    const content = readOllamaContent(data);
    if (!content) throw new Error('resposta sem conteúdo do Ollama');
    return content;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await requestOk({
        provider: 'ollama',
        fetchImpl: this.fetchImpl,
        url: joinUrl(this.settings.baseUrl, '/api/tags'),
        timeoutMs: this.settings.timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function readOllamaContent(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.message)) return null;
  return typeof data.message.content === 'string' && data.message.content.trim().length > 0
    ? data.message.content
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
