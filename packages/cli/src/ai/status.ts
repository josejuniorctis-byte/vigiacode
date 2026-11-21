import { effectiveModel, type LlmConfig, type LlmProvider as ProviderName } from '../config.js';
import {
  createProvider,
  resolveApiKey,
  type LLMProvider,
  type ProviderRuntimeOptions,
} from './providers/index.js';

export interface AiHealthCheck {
  ok: boolean;
  checkedAt: string;
}

export interface AiStatusSnapshot {
  provider: ProviderName;
  model: string | null;
  /** true quando a chave necessária existe (ou quando o provider não exige). */
  keyPresent: boolean;
  lastHealthCheck: AiHealthCheck | null;
}

/** Mantém o último healthCheck para `GET /api/ai/status`. */
export class AiStatusTracker {
  private last: AiHealthCheck | null = null;

  constructor(
    private readonly providerName: ProviderName,
    private readonly provider: LLMProvider | null,
    private readonly model: string | null,
    private readonly keyPresent: boolean,
  ) {}

  snapshot(): AiStatusSnapshot {
    return {
      provider: this.providerName,
      model: this.model,
      keyPresent: this.keyPresent,
      lastHealthCheck: this.last ? { ...this.last } : null,
    };
  }

  async refresh(): Promise<AiHealthCheck> {
    let ok = false;
    if (this.provider) {
      try {
        ok = await this.provider.healthCheck();
      } catch {
        ok = false;
      }
    }

    this.last = { ok, checkedAt: new Date().toISOString() };
    return { ...this.last };
  }
}

export function createAiStatusTracker(
  config: LlmConfig,
  options: ProviderRuntimeOptions = {},
): AiStatusTracker {
  const env = options.env ?? process.env;
  const key = resolveApiKey(config.provider, env);

  let provider: LLMProvider | null = null;
  try {
    provider = createProvider(config, { ...options, env });
  } catch {
    provider = null;
  }

  return new AiStatusTracker(config.provider, provider, effectiveModel(config), key.present);
}
