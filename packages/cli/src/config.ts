import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Nome do diretório de estado local criado na raiz do projeto do usuário. */
export const CONFIG_DIR_NAME = '.codeanchor';
export const CONFIG_FILE_NAME = 'config.json';
export const DATABASE_FILE_NAME = 'codeanchor.db';

/** Porta padrão da API/interface local. */
export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = 'localhost';

/** Padrões do vigia (Etapa 2). */
export const DEFAULT_DEBOUNCE_MS = 1500;
export const DEFAULT_MAX_FILE_SIZE_KB = 500;
export const DEFAULT_MAX_DIFF_KB = 200;
export const DEFAULT_AI_TIMEOUT_MS = 15_000;

/** Modelos/endpoints padrão por provider (podem ser sobrescritos no config). */
export const DEFAULT_BYOK_MODEL = 'gpt-4o-mini';
export const DEFAULT_BYOK_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/** Nunca é gravada no config.json nem no banco. */
export const CODEANCHOR_API_KEY_ENV = 'CODEANCHOR_API_KEY';

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
 * Provider de IA:
 * - none: resumo heurístico local, sem chamadas externas
 * - byok: API compatível com OpenAI (chave em CODEANCHOR_API_KEY)
 * - ollama: modelo local via Ollama
 */
export type LlmProvider = 'none' | 'byok' | 'ollama';

export const LLM_PROVIDERS: readonly LlmProvider[] = ['none', 'byok', 'ollama'];

export interface LlmConfig {
  provider: LlmProvider;
  /** `null` = usar o padrão do provider. */
  model: string | null;
  /** `null` = usar o endpoint padrão do provider. */
  baseUrl: string | null;
  /** Timeout de cada chamada de IA (ms). */
  timeoutMs: number;
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
    case 'byok':
      return { model: DEFAULT_BYOK_MODEL, baseUrl: DEFAULT_BYOK_BASE_URL };
    case 'ollama':
      return { model: DEFAULT_OLLAMA_MODEL, baseUrl: DEFAULT_OLLAMA_BASE_URL };
    case 'none':
    default:
      return { model: null, baseUrl: null };
  }
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

export function writeConfig(projectRoot: string, config: CodeAnchorConfig): string {
  const paths = resolveConfigPaths(projectRoot);
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return paths.configFile;
}

/**
 * Lê e valida a configuração local. Campos novos ausentes recebem o padrão,
 * permitindo abrir configs criados na Etapa 1 sem migração manual.
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

  const provider: LlmProvider =
    typeof llm.provider === 'string' && isLlmProvider(llm.provider) ? llm.provider : 'none';
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
      baseUrl: normalizeOptionalString(llm.baseUrl) ?? llmDefaults.baseUrl,
      timeoutMs: normalizePositiveInt(llm.timeoutMs, DEFAULT_AI_TIMEOUT_MS),
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
