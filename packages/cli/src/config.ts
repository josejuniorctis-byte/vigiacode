import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Nome do diretório de estado local criado na raiz do projeto do usuário. */
export const CONFIG_DIR_NAME = '.codeanchor';
export const CONFIG_FILE_NAME = 'config.json';
export const DATABASE_FILE_NAME = 'codeanchor.db';
export const ENV_FILE_NAME = '.env';

/** Porta padrão da API/interface local. */
export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = 'localhost';

/** Padrões do vigia (Etapa 2). */
export const DEFAULT_DEBOUNCE_MS = 1500;
export const DEFAULT_MAX_FILE_SIZE_KB = 500;
export const DEFAULT_MAX_DIFF_KB = 200;

/** Padrões de IA (Etapa 2.1). */
export const DEFAULT_AI_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0.2;

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/** Compatibilidade com configs/imports antigos da Etapa 2. */
export const DEFAULT_BYOK_MODEL = DEFAULT_OPENAI_MODEL;
export const DEFAULT_BYOK_BASE_URL = DEFAULT_OPENAI_BASE_URL;

/** Chaves de API nunca entram no config.json nem no banco. */
export const CODEANCHOR_API_KEY_ENV = 'CODEANCHOR_API_KEY';
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';
export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';
export const GOOGLE_API_KEY_ENV = 'GOOGLE_API_KEY';

/** Por padrão observamos a raiz do projeto; os ignores cuidam de node_modules etc. */
export const DEFAULT_WATCH_PATHS = ['.'];

export const DEFAULT_IGNORES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.codeanchor',
  '*.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  '*.min.js',
];

/**
 * Providers de IA:
 * - none: resumo heurístico local, sem chamadas externas
 * - openai: API da OpenAI
 * - anthropic: API da Anthropic (Claude)
 * - gemini: API do Google Gemini
 * - openai-compatible: qualquer API compatível com OpenAI (OpenRouter, Groq, DeepSeek, LM Studio…)
 * - ollama: modelo local via Ollama
 */
export type LlmProvider =
  'none' | 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'ollama';

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  'none',
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
  'ollama',
];

export interface LlmConfig {
  provider: LlmProvider;
  /** `null` = usar o padrão do provider. */
  model: string | null;
  /** `null` = usar o endpoint padrão do provider. */
  baseUrl: string | null;
  /** Timeout de cada chamada de IA (ms). */
  timeoutMs: number;
  /** Limite de tokens da resposta. */
  maxTokens?: number;
  /** Temperatura da geração (0 a 2). */
  temperature?: number;
  /** Providers tentados em ordem se o principal falhar (opcional). */
  fallbackProviders?: LlmProvider[];
}

export interface WatchConfig {
  /** Caminhos relativos à raiz do projeto. */
  paths: string[];
  /** Padrões ignorados pelo watcher (glob/gitignore-like). */
  ignore: string[];
  /** Agrupa mudanças rápidas num único lote (ms). */
  debounceMs: number;
  /** Arquivos maiores que isso são ignorados (KB). */
  maxFileSizeKb: number;
}

export interface GitConfig {
  /** Diffs maiores que isso são truncados (KB). */
  maxDiffKb: number;
}

export interface ServerConfig {
  host: string;
  port: number;
}

export interface DatabaseConfig {
  /** SQLite hoje; a camada de banco está isolada para suportar PostgreSQL no futuro. */
  dialect: 'sqlite';
  /** Caminho absoluto ou relativo à pasta .codeanchor/. */
  file: string;
}

export interface CodeAnchorConfig {
  version: 1;
  project: {
    name: string;
    rootPath: string;
  };
  watch: WatchConfig;
  git: GitConfig;
  llm: LlmConfig;
  server: ServerConfig;
  database: DatabaseConfig;
}

export interface ConfigPaths {
  rootDir: string;
  configDir: string;
  configFile: string;
  databaseFile: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Resolve os caminhos de estado local a partir da raiz do projeto do usuário. */
export function resolveConfigPaths(
  projectRoot: string,
  databaseFile: string = DATABASE_FILE_NAME,
): ConfigPaths {
  const rootDir = path.resolve(projectRoot);
  const configDir = path.join(rootDir, CONFIG_DIR_NAME);
  return {
    rootDir,
    configDir,
    configFile: path.join(configDir, CONFIG_FILE_NAME),
    databaseFile: path.isAbsolute(databaseFile) ? databaseFile : path.join(configDir, databaseFile),
  };
}

/** Caminho do .codeanchor/.env (carregado no start/ai test). */
export function projectEnvPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), CONFIG_DIR_NAME, ENV_FILE_NAME);
}

/** Nome padrão do projeto: nome da pasta raiz. */
export function defaultProjectName(projectRoot: string): string {
  const name = path.basename(path.resolve(projectRoot));
  return name.length > 0 ? name : 'projeto';
}

export function isLlmProvider(value: string): value is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

/** Modelo e endpoint padrão para cada provider. */
export function providerDefaults(provider: LlmProvider): {
  model: string | null;
  baseUrl: string | null;
} {
  switch (provider) {
    case 'openai':
      return { model: DEFAULT_OPENAI_MODEL, baseUrl: DEFAULT_OPENAI_BASE_URL };
    case 'anthropic':
      return { model: DEFAULT_ANTHROPIC_MODEL, baseUrl: DEFAULT_ANTHROPIC_BASE_URL };
    case 'gemini':
      return { model: DEFAULT_GEMINI_MODEL, baseUrl: DEFAULT_GEMINI_BASE_URL };
    case 'ollama':
      return { model: DEFAULT_OLLAMA_MODEL, baseUrl: DEFAULT_OLLAMA_BASE_URL };
    case 'openai-compatible':
      return { model: null, baseUrl: null };
    case 'none':
    default:
      return { model: null, baseUrl: null };
  }
}

/** Valores efetivos de timeout/max tokens/temperatura, aplicando padrões. */
export function resolvedLlmSettings(config: LlmConfig): {
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  fallbackProviders: LlmProvider[];
} {
  return {
    timeoutMs: normalizePositiveInt(config.timeoutMs, DEFAULT_AI_TIMEOUT_MS),
    maxTokens: normalizePositiveInt(config.maxTokens, DEFAULT_MAX_TOKENS),
    temperature: normalizeTemperature(config.temperature),
    fallbackProviders: config.fallbackProviders ?? [],
  };
}

export function effectiveModel(config: Pick<LlmConfig, 'provider' | 'model'>): string | null {
  return config.model ?? providerDefaults(config.provider).model;
}

export interface CreateConfigInput {
  name: string;
  rootPath: string;
  provider?: LlmProvider;
  model?: string | null;
  baseUrl?: string | null;
  debounceMs?: number;
  maxFileSizeKb?: number;
  maxDiffKb?: number;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  fallbackProviders?: LlmProvider[];
}

export function createDefaultConfig(input: CreateConfigInput): CodeAnchorConfig {
  const provider = input.provider ?? 'none';
  const defaults = providerDefaults(provider);

  return {
    version: 1,
    project: {
      name: input.name,
      rootPath: path.resolve(input.rootPath),
    },
    watch: {
      paths: [...DEFAULT_WATCH_PATHS],
      ignore: [...DEFAULT_IGNORES],
      debounceMs: normalizePositiveInt(input.debounceMs, DEFAULT_DEBOUNCE_MS),
      maxFileSizeKb: normalizePositiveInt(input.maxFileSizeKb, DEFAULT_MAX_FILE_SIZE_KB),
    },
    git: {
      maxDiffKb: normalizePositiveInt(input.maxDiffKb, DEFAULT_MAX_DIFF_KB),
    },
    llm: {
      provider,
      model: normalizeOptionalString(input.model) ?? defaults.model,
      baseUrl: normalizeOptionalString(input.baseUrl) ?? defaults.baseUrl,
      timeoutMs: normalizePositiveInt(input.timeoutMs, DEFAULT_AI_TIMEOUT_MS),
      maxTokens: normalizePositiveInt(input.maxTokens, DEFAULT_MAX_TOKENS),
      temperature: normalizeTemperature(input.temperature),
      fallbackProviders: input.fallbackProviders ?? [],
    },
    server: {
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
    },
    database: {
      dialect: 'sqlite',
      file: DATABASE_FILE_NAME,
    },
  };
}

export function configExists(projectRoot: string): boolean {
  return existsSync(resolveConfigPaths(projectRoot).configFile);
}

/**
 * Grava o config com os campos de IA em snake_case (base_url, max_tokens,
 * timeout, fallback_providers), mantendo o restante do formato.
 */
export function writeConfig(projectRoot: string, config: CodeAnchorConfig): string {
  const paths = resolveConfigPaths(projectRoot);
  mkdirSync(paths.configDir, { recursive: true });

  const serializable = {
    version: config.version,
    project: config.project,
    watch: config.watch,
    git: config.git,
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      base_url: config.llm.baseUrl,
      timeout: config.llm.timeoutMs,
      max_tokens: config.llm.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: config.llm.temperature ?? DEFAULT_TEMPERATURE,
      fallback_providers: config.llm.fallbackProviders ?? [],
    },
    server: config.server,
    database: config.database,
  };

  writeFileSync(paths.configFile, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
  return paths.configFile;
}

/**
 * Lê e valida a configuração local.
 *
 * Compatibilidade: aceita campos antigos em camelCase e o provider legado
 * "byok", migrado para "openai" ou "openai-compatible" conforme o base_url.
 */
export function readConfig(projectRoot: string): CodeAnchorConfig {
  const paths = resolveConfigPaths(projectRoot);
  if (!existsSync(paths.configFile)) {
    throw new ConfigError(
      `Configuração não encontrada em ${paths.configFile}. Rode "codeanchor init" primeiro.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(paths.configFile, 'utf8'));
  } catch {
    throw new ConfigError(
      `Não foi possível ler ${paths.configFile}. Verifique se o JSON está válido.`,
    );
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError(`Formato inválido em ${paths.configFile}.`);
  }

  const data = raw as Record<string, unknown>;
  const project = (data.project ?? {}) as Record<string, unknown>;
  const watch = (data.watch ?? {}) as Record<string, unknown>;
  const git = (data.git ?? {}) as Record<string, unknown>;
  const llm = (data.llm ?? {}) as Record<string, unknown>;
  const server = (data.server ?? {}) as Record<string, unknown>;
  const database = (data.database ?? {}) as Record<string, unknown>;

  if (typeof project.name !== 'string' || project.name.trim().length === 0) {
    throw new ConfigError('config.json inválido: "project.name" é obrigatório.');
  }

  const rawBaseUrl = normalizeOptionalString(llm.base_url ?? llm.baseUrl);
  const provider = resolveProvider(llm.provider, rawBaseUrl);
  const llmDefaults = providerDefaults(provider);

  const defaults = createDefaultConfig({
    name: project.name,
    rootPath: typeof project.rootPath === 'string' ? project.rootPath : paths.rootDir,
    provider,
  });

  const port =
    typeof server.port === 'number' && Number.isInteger(server.port) && server.port > 0
      ? server.port
      : defaults.server.port;

  return {
    version: 1,
    project: {
      name: project.name,
      rootPath:
        typeof project.rootPath === 'string' && project.rootPath.length > 0
          ? project.rootPath
          : paths.rootDir,
    },
    watch: {
      paths: stringArray(watch.paths, defaults.watch.paths),
      ignore: stringArray(watch.ignore, defaults.watch.ignore),
      debounceMs: normalizePositiveInt(watch.debounceMs, DEFAULT_DEBOUNCE_MS),
      maxFileSizeKb: normalizePositiveInt(watch.maxFileSizeKb, DEFAULT_MAX_FILE_SIZE_KB),
    },
    git: {
      maxDiffKb: normalizePositiveInt(git.maxDiffKb, DEFAULT_MAX_DIFF_KB),
    },
    llm: {
      provider,
      model: normalizeOptionalString(llm.model) ?? llmDefaults.model,
      baseUrl: rawBaseUrl ?? llmDefaults.baseUrl,
      timeoutMs: normalizePositiveInt(llm.timeout ?? llm.timeoutMs, DEFAULT_AI_TIMEOUT_MS),
      maxTokens: normalizePositiveInt(llm.max_tokens ?? llm.maxTokens, DEFAULT_MAX_TOKENS),
      temperature: normalizeTemperature(llm.temperature),
      fallbackProviders: parseFallbackProviders(llm.fallback_providers ?? llm.fallbackProviders),
    },
    server: {
      host:
        typeof server.host === 'string' && server.host.length > 0
          ? server.host
          : defaults.server.host,
      port,
    },
    database: {
      dialect: 'sqlite',
      file:
        typeof database.file === 'string' && database.file.length > 0
          ? database.file
          : DATABASE_FILE_NAME,
    },
  };
}

/** Normaliza o provider, incluindo a migração do antigo "byok". */
export function resolveProvider(value: unknown, baseUrl: string | null): LlmProvider {
  if (typeof value !== 'string') return 'none';
  if (value === 'byok') {
    return baseUrl !== null && !isOpenAiBaseUrl(baseUrl) ? 'openai-compatible' : 'openai';
  }
  return isLlmProvider(value) ? value : 'none';
}

/** true para o endpoint oficial da OpenAI (ou quando base_url está ausente). */
export function isOpenAiBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'api.openai.com';
  } catch {
    return baseUrl.trim().toLowerCase().startsWith('https://api.openai.com');
  }
}

export function parseFallbackProviders(value: unknown): LlmProvider[] {
  if (!Array.isArray(value)) return [];
  const providers: LlmProvider[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const provider = resolveProvider(item, null);
    if (!providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : [...fallback];
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

function normalizeTemperature(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2) {
    return value;
  }
  return DEFAULT_TEMPERATURE;
}
