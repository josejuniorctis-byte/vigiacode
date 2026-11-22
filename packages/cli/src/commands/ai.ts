import path from 'node:path';
import {
  effectiveModel,
  configExists,
  providerDefaults,
  readConfig,
  writeConfig,
  type LlmProvider,
} from '../config.js';
import {
  createProvider,
  describeProviderError,
  sanitizeSummary,
  type LLMProvider,
} from '../ai/index.js';
import { loadProjectEnv } from '../utils/env.js';
import { logger } from '../utils/logger.js';

export interface AiTestOptions {
  cwd: string;
}

/** `vigiacode ai test`: faz uma chamada curta e mostra tempo/modelo/resposta. */
export async function runAiTest(options: AiTestOptions): Promise<void> {
  const projectRoot = path.resolve(options.cwd);
  logger.intro('VigiaCode · ai test');

  if (!configExists(projectRoot)) {
    logger.error('Este projeto ainda não foi inicializado.');
    logger.hint('Rode "vigiacode init" na raiz do projeto.');
    process.exitCode = 1;
    return;
  }

  const envLoad = loadProjectEnv(projectRoot);
  if (envLoad.loaded.length > 0) {
    logger.detail(`.vigiacode/.env carregado (${envLoad.loaded.length} variável(is)).`);
  }

  const config = readConfig(projectRoot);
  const providerName = config.llm.provider;
  const model = effectiveModel(config.llm);

  if (providerName === 'none') {
    logger.info('Provider "none": o VigiaCode usa resumo heurístico local.');
    logger.detail('Nenhuma chamada de IA será feita.');
    logger.hint('Para usar IA: vigiacode ai use ollama --model llama3.2');
    return;
  }

  let provider: LLMProvider;
  try {
    provider = createProvider(config.llm);
  } catch (error) {
    logger.error(
      describeProviderError(error, providerName, {
        baseUrl: config.llm.baseUrl ?? providerDefaults(providerName).baseUrl,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  try {
    const answer = await provider.complete(
      'Responda em uma frase curta, em português: qual é o objetivo do VigiaCode?',
      {
        system: 'Você é um assistente técnico objetivo. Responda em português do Brasil.',
      },
    );
    const elapsed = Date.now() - started;
    const sample = sanitizeSummary(answer, 320);

    logger.success(`Provider "${providerName}" respondeu em ${elapsed} ms.`);
    logger.detail(`Modelo: ${model ?? 'padrão do provider'}`);
    logger.detail(`Resposta: ${sample || '(vazia)'}`);
    logger.blank();
    logger.hint('Esse provider será usado pelo vigia nos próximos resumos.');
  } catch (error) {
    logger.error(
      describeProviderError(error, providerName, {
        baseUrl: config.llm.baseUrl ?? providerDefaults(providerName).baseUrl,
      }),
    );
    process.exitCode = 1;
  }
}

export interface AiUseOptions {
  cwd: string;
  provider: LlmProvider;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

/** `vigiacode ai use <provider>`: troca o provider sem refazer o init. */
export async function runAiUse(options: AiUseOptions): Promise<void> {
  const projectRoot = path.resolve(options.cwd);
  logger.intro('VigiaCode · ai use');

  if (!configExists(projectRoot)) {
    logger.error('Este projeto ainda não foi inicializado.');
    logger.hint('Rode "vigiacode init" na raiz do projeto.');
    process.exitCode = 1;
    return;
  }

  const config = readConfig(projectRoot);
  const provider = options.provider;
  const sameProvider = config.llm.provider === provider;
  const defaults = providerDefaults(provider);

  let model = options.model?.trim() || (sameProvider ? config.llm.model : defaults.model);
  let baseUrl = options.baseUrl?.trim() || (sameProvider ? config.llm.baseUrl : defaults.baseUrl);

  if (provider === 'none') {
    model = null;
    baseUrl = null;
  }

  if (provider === 'openai-compatible' && !baseUrl) {
    logger.error('O provider "openai-compatible" exige um endpoint.');
    logger.hint(
      'vigiacode ai use openai-compatible --base-url https://openrouter.ai/api/v1 --model <modelo>',
    );
    process.exitCode = 1;
    return;
  }
  if (provider === 'openai-compatible' && !model) {
    logger.error('O provider "openai-compatible" exige um modelo.');
    logger.hint(
      'vigiacode ai use openai-compatible --base-url https://openrouter.ai/api/v1 --model <modelo>',
    );
    process.exitCode = 1;
    return;
  }

  const updated = {
    ...config,
    llm: {
      ...config.llm,
      provider,
      model,
      baseUrl,
    },
  };
  writeConfig(projectRoot, updated);

  logger.success(`Provider alterado para "${provider}".`);
  if (model) logger.detail(`Modelo: ${model}`);
  if (baseUrl) logger.detail(`Endpoint: ${baseUrl}`);
  logger.blank();
  logger.hint('Valide com "vigiacode ai test".');
}
