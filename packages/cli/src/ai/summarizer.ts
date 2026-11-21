import { resolvedLlmSettings, type LlmConfig, type LlmProvider } from '../config.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { sanitizeSummary, summarizeHeuristic } from './heuristic.js';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from './prompt.js';
import { describeProviderError } from './providers/errors.js';
import { createProvider, type LLMProvider } from './providers/index.js';
import type { Summarizer, SummarizerLogger, SummarizerOptions, SummaryInput } from './types.js';

/**
 * Fábrica de resumidores.
 *
 * O provider principal e os `fallbackProviders` (em ordem) tentam gerar o resumo;
 * qualquer falha cai no resumo heurístico local, então todo evento termina com
 * `summary` preenchido.
 */
export function createSummarizer(config: LlmConfig, options: SummarizerOptions = {}): Summarizer {
  const heuristic = new HeuristicSummarizer();
  if (config.provider === 'none') return heuristic;

  const logger = options.logger ?? defaultLogger;
  const providers: ProviderSummarizer[] = [];

  for (const name of buildProviderChain(config)) {
    if (name === 'none') continue;

    try {
      const providerConfig: LlmConfig =
        name === config.provider
          ? config
          : { ...config, provider: name, model: null, baseUrl: null };
      const provider = createProvider(providerConfig, {
        fetchImpl: options.fetchImpl,
        env: options.env,
      });
      providers.push(new ProviderSummarizer(provider, resolvedLlmSettings(providerConfig)));
    } catch (error) {
      logger.warn(`Provider de IA "${name}" indisponível: ${describeProviderError(error, name)}`);
    }
  }

  if (providers.length === 0) return heuristic;
  return new ChainSummarizer(config.provider, providers, heuristic, logger);
}

/** Resumo local determinístico: provider `none` e fallback dos demais. */
export class HeuristicSummarizer implements Summarizer {
  readonly provider = 'none' as const;

  async summarize(input: SummaryInput): Promise<string> {
    return summarizeHeuristic(input);
  }
}

interface ResolvedSettings {
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

class ProviderSummarizer implements Summarizer {
  readonly provider: LlmProvider;

  constructor(
    private readonly llm: LLMProvider,
    private readonly settings: ResolvedSettings,
  ) {
    this.provider = llm.name;
  }

  async summarize(input: SummaryInput): Promise<string> {
    const prompt = buildSummaryPrompt(input);
    const content = await this.llm.complete(prompt, {
      system: SUMMARY_SYSTEM_PROMPT,
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature,
      timeoutMs: this.settings.timeoutMs,
    });

    const summary = sanitizeSummary(content);
    if (!summary) throw new Error('resposta vazia da IA');
    return summary;
  }
}

class ChainSummarizer implements Summarizer {
  private readonly warnedProviders = new Set<LlmProvider>();
  private warnedHeuristic = false;

  constructor(
    readonly provider: LlmProvider,
    private readonly providers: ProviderSummarizer[],
    private readonly heuristic: HeuristicSummarizer,
    private readonly logger: SummarizerLogger,
  ) {}

  async summarize(input: SummaryInput): Promise<string> {
    for (const candidate of this.providers) {
      try {
        return await candidate.summarize(input);
      } catch (error) {
        if (!this.warnedProviders.has(candidate.provider)) {
          this.warnedProviders.add(candidate.provider);
          this.logger.warn(
            `Resumo por IA indisponível (${candidate.provider}): ${describeProviderError(
              error,
              candidate.provider,
            )}`,
          );
        }
      }
    }

    if (!this.warnedHeuristic) {
      this.warnedHeuristic = true;
      this.logger.warn('Continuando com resumo heurístico local.');
    }
    return this.heuristic.summarize(input);
  }
}

/** Provider principal + fallbacks, sem duplicatas. */
export function buildProviderChain(config: LlmConfig): LlmProvider[] {
  const chain: LlmProvider[] = [config.provider];
  for (const provider of config.fallbackProviders ?? []) {
    if (!chain.includes(provider)) chain.push(provider);
  }
  return chain;
}
