import {
  CODEANCHOR_API_KEY_ENV,
  DEFAULT_BYOK_BASE_URL,
  DEFAULT_BYOK_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  type LlmConfig,
} from '../config.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { sanitizeSummary, summarizeHeuristic } from './heuristic.js';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from './prompt.js';
import type { Summarizer, SummarizerOptions, SummaryInput } from './types.js';

/**
 * Fábrica de resumidores.
 *
 * - none: HeuristicSummarizer (local, sem rede)
 * - byok: ByokSummarizer (API compatível com OpenAI)
 * - ollama: OllamaSummarizer (/api/chat)
 *
 * Qualquer falha de IA cai no resumo heurístico, então todo evento termina com
 * `summary` preenchido.
 */
export function createSummarizer(config: LlmConfig, options: SummarizerOptions = {}): Summarizer {
  const heuristic = new HeuristicSummarizer();
  if (config.provider === 'none') return heuristic;

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const primary =
    config.provider === 'byok'
      ? new ByokSummarizer(config, fetchImpl)
      : new OllamaSummarizer(config, fetchImpl);

  return withHeuristicFallback(primary, heuristic, options);
}

/** Resumo local determinístico: provider `none` e fallback dos demais. */
export class HeuristicSummarizer implements Summarizer {
  readonly provider = 'none' as const;

  async summarize(input: SummaryInput): Promise<string> {
    return summarizeHeuristic(input);
  }
}

/** API compatível com OpenAI; a chave vem só de CODEANCHOR_API_KEY. */
export class ByokSummarizer implements Summarizer {
  readonly provider = 'byok' as const;

  constructor(
    private readonly config: LlmConfig,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async summarize(input: SummaryInput): Promise<string> {
    const apiKey = process.env[CODEANCHOR_API_KEY_ENV]?.trim();
    if (!apiKey) {
      throw new Error(`defina a variável ${CODEANCHOR_API_KEY_ENV}`);
    }

    const baseUrl = this.config.baseUrl ?? DEFAULT_BYOK_BASE_URL;
    const model = this.config.model ?? DEFAULT_BYOK_MODEL;
    const data = await postJson(
      this.fetchImpl,
      resolveEndpoint(baseUrl, '/chat/completions'),
      buildChatBody(model, buildSummaryPrompt(input)),
      this.config.timeoutMs,
      { Authorization: `Bearer ${apiKey}` },
    );

    const content = readByokContent(data);
    if (!content) throw new Error('resposta sem conteúdo da API OpenAI-compatível');
    return content;
  }
}

/** Ollama local em /api/chat. */
export class OllamaSummarizer implements Summarizer {
  readonly provider = 'ollama' as const;

  constructor(
    private readonly config: LlmConfig,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async summarize(input: SummaryInput): Promise<string> {
    const baseUrl = this.config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    const model = this.config.model ?? DEFAULT_OLLAMA_MODEL;
    const data = await postJson(
      this.fetchImpl,
      resolveEndpoint(baseUrl, '/api/chat'),
      {
        ...buildChatBody(model, buildSummaryPrompt(input)),
        stream: false,
        options: { temperature: 0.2 },
      },
      this.config.timeoutMs,
    );

    const content = readOllamaContent(data);
    if (!content) throw new Error('resposta sem conteúdo do Ollama');
    return content;
  }
}

function withHeuristicFallback(
  primary: Summarizer,
  heuristic: HeuristicSummarizer,
  options: SummarizerOptions,
): Summarizer {
  const logger = options.logger ?? defaultLogger;
  let warned = false;

  return {
    provider: primary.provider,
    async summarize(input: SummaryInput): Promise<string> {
      try {
        const summary = sanitizeSummary(await primary.summarize(input));
        if (!summary) throw new Error('resposta vazia da IA');
        return summary;
      } catch (error) {
        if (!warned) {
          warned = true;
          const reason = error instanceof Error ? error.message : String(error);
          logger.warn(`Resumo por IA indisponível (${primary.provider}): ${reason}`);
          logger.warn('Continuando com resumo heurístico local.');
        }
        return heuristic.summarize(input);
      }
    },
  };
}

function buildChatBody(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch indisponível neste runtime');
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  return response.json();
}

export function resolveEndpoint(baseUrl: string, endpoint: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith(endpoint) ? trimmed : `${trimmed}${endpoint}`;
}

function readByokContent(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.choices)) return null;
  const first = data.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  return typeof first.message.content === 'string' ? first.message.content : null;
}

function readOllamaContent(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.message)) return null;
  return typeof data.message.content === 'string' ? data.message.content : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
