import { anthropicMessagesUrl, anthropicModelsUrl, requestJson, requestOk } from './http.js';
import { requireApiKey, resolveApiKey } from './keys.js';
import type { CompletionOptions, LLMProvider, ProviderSettings } from './types.js';

export const ANTHROPIC_VERSION = '2023-06-01';

/** Anthropic Claude em /v1/messages. */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const apiKey = requireApiKey('anthropic', this.env);
    const model = options.model ?? this.settings.model;

    const data = await requestJson({
      provider: 'anthropic',
      fetchImpl: this.fetchImpl,
      url: anthropicMessagesUrl(this.settings.baseUrl),
      method: 'POST',
      timeoutMs: options.timeoutMs ?? this.settings.timeoutMs,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: {
        model,
        max_tokens: options.maxTokens ?? this.settings.maxTokens,
        temperature: options.temperature ?? this.settings.temperature,
        ...(options.system ? { system: options.system } : {}),
        messages: [{ role: 'user', content: prompt }],
      },
    });

    const content = readAnthropicContent(data);
    if (!content) throw new Error('resposta sem conteúdo da API Anthropic');
    return content;
  }

  async healthCheck(): Promise<boolean> {
    const apiKey = resolveApiKey('anthropic', this.env);
    if (!apiKey.present || !apiKey.key) return false;

    try {
      await requestOk({
        provider: 'anthropic',
        fetchImpl: this.fetchImpl,
        url: anthropicModelsUrl(this.settings.baseUrl),
        timeoutMs: this.settings.timeoutMs,
        headers: {
          'x-api-key': apiKey.key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function readAnthropicContent(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.content)) return null;
  const texts = data.content
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string);

  const content = texts.join('\n').trim();
  return content.length > 0 ? content : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
