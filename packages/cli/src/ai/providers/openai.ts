import { joinUrl, requestJson, requestOk } from './http.js';
import { requireApiKey, resolveApiKey } from './keys.js';
import type { CompletionOptions, LLMProvider, ProviderSettings } from './types.js';

/** OpenAI e qualquer endpoint compatível (OpenRouter, Groq, DeepSeek, LM Studio…). */
export class OpenAiProvider implements LLMProvider {
  constructor(
    readonly name: 'openai' | 'openai-compatible',
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const apiKey = requireApiKey(this.name, this.env);
    const model = options.model ?? this.settings.model;
    const messages: Array<{ role: string; content: string }> = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });

    const data = await requestJson({
      provider: this.name,
      fetchImpl: this.fetchImpl,
      url: joinUrl(this.settings.baseUrl, '/chat/completions'),
      method: 'POST',
      timeoutMs: options.timeoutMs ?? this.settings.timeoutMs,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages,
        max_tokens: options.maxTokens ?? this.settings.maxTokens,
        temperature: options.temperature ?? this.settings.temperature,
        stream: false,
      },
    });

    const content = readOpenAiContent(data);
    if (!content) throw new Error('resposta sem conteúdo da API OpenAI-compatível');
    return content;
  }

  async healthCheck(): Promise<boolean> {
    const apiKey = resolveApiKey(this.name, this.env);
    if (!apiKey.present || !apiKey.key) return false;

    try {
      await requestOk({
        provider: this.name,
        fetchImpl: this.fetchImpl,
        url: joinUrl(this.settings.baseUrl, '/models'),
        timeoutMs: this.settings.timeoutMs,
        headers: { Authorization: `Bearer ${apiKey.key}` },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function readOpenAiContent(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.choices)) return null;
  const first = data.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  return textOf(first.message.content);
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
