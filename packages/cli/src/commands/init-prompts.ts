import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { LLM_PROVIDERS, isLlmProvider, providerDefaults, type LlmProvider } from '../config.js';
import { logger } from '../utils/logger.js';

export interface ProviderChoice {
  provider: LlmProvider;
  model?: string;
  baseUrl?: string;
}

export function canPrompt(): boolean {
  return stdin.isTTY === true;
}

/**
 * Pergunta interativamente o provider e o modelo (usado pelo `init` sem --yes).
 * Retorna null quando não há terminal interativo.
 */
export async function promptProviderChoice(): Promise<ProviderChoice | null> {
  if (!canPrompt()) return null;

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const provider = await askProvider(rl);
    if (provider === 'none') return { provider };

    const defaults = providerDefaults(provider);
    const model = await askModel(rl, defaults.model);
    const baseUrl =
      provider === 'openai-compatible' ? await askBaseUrl(rl) : (defaults.baseUrl ?? undefined);

    return { provider, model: model ?? undefined, baseUrl };
  } finally {
    rl.close();
  }
}

async function askProvider(rl: ReturnType<typeof createInterface>): Promise<LlmProvider> {
  const options = LLM_PROVIDERS.join(' | ');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = (await rl.question(`Provider de IA [${options}] (none): `)).trim().toLowerCase();
    if (answer.length === 0) return 'none';
    if (isLlmProvider(answer)) return answer;
    logger.warn(`Provider inválido: "${answer}". Use: ${options}.`);
  }
  return 'none';
}

async function askModel(
  rl: ReturnType<typeof createInterface>,
  defaultModel: string | null,
): Promise<string | null> {
  const suffix = defaultModel ? ` (padrão: ${defaultModel})` : ' (obrigatório)';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = (await rl.question(`Modelo${suffix}: `)).trim();
    if (answer.length === 0 && defaultModel) return defaultModel;
    if (answer.length > 0) return answer;
    logger.warn('Informe um modelo para continuar.');
  }
  return defaultModel;
}

async function askBaseUrl(rl: ReturnType<typeof createInterface>): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = (await rl.question('Base URL (ex.: https://openrouter.ai/api/v1): ')).trim();
    if (isHttpUrl(answer)) return answer.replace(/\/+$/, '');
    logger.warn('Base URL inválida. Use http:// ou https://.');
  }
  throw new Error('Base URL é obrigatória para o provider openai-compatible.');
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Pergunta apenas o modelo (quando o provider já veio por flag). */
export async function promptModelForProvider(defaultModel: string | null): Promise<string | null> {
  if (!canPrompt()) return defaultModel;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await askModel(rl, defaultModel);
  } finally {
    rl.close();
  }
}

/** Pergunta a base URL para providers OpenAI-compatible. */
export async function promptBaseUrlForProvider(): Promise<string | undefined> {
  if (!canPrompt()) return undefined;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await askBaseUrl(rl);
  } finally {
    rl.close();
  }
}
