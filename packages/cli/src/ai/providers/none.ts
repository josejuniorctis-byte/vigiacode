import { ProviderConfigError } from './errors.js';
import type { CompletionOptions, LLMProvider } from './types.js';

/** Provider `none`: não faz chamadas; o Summarizer usa o heurístico local. */
export class NoneProvider implements LLMProvider {
  readonly name = 'none' as const;

  async complete(_prompt: string, _options?: CompletionOptions): Promise<string> {
    throw new ProviderConfigError(
      'O provider "none" não usa IA; o CodeAnchor gera um resumo heurístico local.',
    );
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
