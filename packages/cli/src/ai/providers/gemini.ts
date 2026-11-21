import { geminiGenerateUrl, geminiModelsUrl, requestJson, requestOk } from './http.js';
import { requireApiKey, resolveApiKey } from './keys.js';
import type { CompletionOptions, LLMProvider, ProviderSettings } from './types.js';

/** Google Gemini em /v1beta/models/{model}:generateContent. */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;

  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const apiKey = requireApiKey('gemini', this.env);
    const model = options.model ?? this.settings.model;

    const data = await requestJson({
      provider: 'gemini',
      fetchImpl: this.fetchImpl,
      url: geminiGenerateUrl(this.settings.baseUrl, model),
      method: 'POST',
      timeoutMs: options.timeoutMs ?? this.settings.timeoutMs,
      headers: { 'x-goog-api-key': apiKey },
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
        generationConfig: {
          temperature: options.temperature ?? this.settings.temperature,
          maxOutputTokens: options.maxTokens ?? this.settings.maxTokens,
        },
      },
    });

    const content = readGeminiContent(data);
    if (!content) throw new Error('resposta sem conteúdo da API Gemini');
    return content;
  }

  async healthCheck(): Promise<boolean> {
    const apiKey = resolveApiKey('gemini', this.env);
    if (!apiKey.present || !apiKey.key) return false;

    try {
      await requestOk({
        provider: 'gemini',
        fetchImpl: this.fetchImpl,
        url: geminiModelsUrl(this.settings.baseUrl),
        timeoutMs: this.settings.timeoutMs,
        headers: { 'x-goog-api-key': apiKey.key },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function readGeminiContent(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.candidates)) return null;
  const candidate = data.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content)) return null;
  if (!Array.isArray(candidate.content.parts)) return null;

  const content = candidate.content.parts
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return content.length > 0 ? content : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
