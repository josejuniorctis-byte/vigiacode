import {
  providerDefaults,
  resolvedLlmSettings,
  type LlmConfig,
  type LlmProvider,
} from '../../config.js';
import { AnthropicProvider } from './anthropic.js';
import { ProviderConfigError } from './errors.js';
import { GeminiProvider } from './gemini.js';
import { NoneProvider } from './none.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiProvider } from './openai.js';
import type { LLMProvider, ProviderRuntimeOptions, ProviderSettings } from './types.js';

export function createProvider(
  config: LlmConfig,
  options: ProviderRuntimeOptions = {},
): LLMProvider {
  const provider = config.provider;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const env = options.env ?? process.env;

  if (provider === 'none') return new NoneProvider();

  const defaults = providerDefaults(provider);
  const model = config.model ?? defaults.model;
  const baseUrl = config.baseUrl ?? defaults.baseUrl;

  if (!model) {
    throw new ProviderConfigError(
      `O provider "${provider}" exige um modelo. Use --model ou defina "model" no config.`,
    );
  }
  if (!baseUrl) {
    throw new ProviderConfigError(
      `O provider "${provider}" exige um endpoint em base_url. ` +
        'Ex.: vigiacode ai use openai-compatible --base-url https://openrouter.ai/api/v1 --model <modelo>.',
    );
  }

  const resolved = resolvedLlmSettings(config);
  const settings: ProviderSettings = {
    model,
    baseUrl,
    timeoutMs: resolved.timeoutMs,
    maxTokens: resolved.maxTokens,
    temperature: resolved.temperature,
  };

  switch (provider) {
    case 'openai':
    case 'openai-compatible':
      return new OpenAiProvider(provider, settings, fetchImpl, env);
    case 'anthropic':
      return new AnthropicProvider(settings, fetchImpl, env);
    case 'gemini':
      return new GeminiProvider(settings, fetchImpl, env);
    case 'ollama':
      return new OllamaProvider(settings, fetchImpl);
    default:
      throw new ProviderConfigError(`Provider desconhecido: "${String(provider)}".`);
  }
}

export type ProviderName = Exclude<LlmProvider, 'none'>;

export { AnthropicProvider, GeminiProvider, NoneProvider, OllamaProvider, OpenAiProvider };
export { ProviderConfigError } from './errors.js';
export { apiKeyCandidates, MissingApiKeyError, requiresApiKey, resolveApiKey } from './keys.js';
export type { ApiKeyStatus } from './keys.js';
export type {
  CompletionOptions,
  LLMProvider,
  ProviderRuntimeOptions,
  ProviderSettings,
} from './types.js';
