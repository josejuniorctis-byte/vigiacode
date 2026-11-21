import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  createDefaultConfig,
  defaultProjectName,
  readConfig,
  resolveConfigPaths,
  writeConfig,
  type CodeAnchorConfig,
  type LlmProvider,
} from '../config.js';
import { applyMigrations, openDatabase, registerProject } from '../db/index.js';
import { logger } from '../utils/logger.js';

export type InitStatus = 'created' | 'already-initialized' | 'reinitialized';
export type GitignoreStatus = 'added' | 'present' | 'missing' | 'skipped';

export interface InitOptions {
  /** Raiz do projeto do usuário (normalmente process.cwd()). */
  cwd: string;
  name?: string | undefined;
  provider?: LlmProvider | undefined;
  model?: string | null | undefined;
  baseUrl?: string | null | undefined;
  debounceMs?: number | undefined;
  maxFileSizeKb?: number | undefined;
  maxDiffKb?: number | undefined;
  timeoutMs?: number | undefined;
  force?: boolean | undefined;
  yes?: boolean | undefined;
  /** Injetável nos testes; padrão pergunta no terminal. */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
}

export interface InitResult {
  status: InitStatus;
  projectRoot: string;
  configPath: string;
  databasePath: string;
  projectId: string | null;
  gitignore: GitignoreStatus;
  config?: CodeAnchorConfig;
}

/**
 * `codeanchor init`: cria .codeanchor/ (config.json + codeanchor.db), aplica as
 * migrations, registra o projeto e atualiza o .gitignore do usuário.
 */
export async function runInit(options: InitOptions): Promise<InitResult> {
  const projectRoot = path.resolve(options.cwd);
  const paths = resolveConfigPaths(projectRoot);

  logger.intro('CodeAnchor · init');

  if (existsSync(paths.configFile) && !options.force) {
    logger.warn('Este projeto já está inicializado.');
    logger.detail(`Configuração: ${toPosix(path.relative(projectRoot, paths.configFile))}`);
    logger.hint(
      'Use "codeanchor init --force" para recriar a configuração (o banco existente é preservado).',
    );

    let config: CodeAnchorConfig | undefined;
    try {
      config = readConfig(projectRoot);
    } catch {
      config = undefined;
    }

    return {
      status: 'already-initialized',
      projectRoot,
      configPath: paths.configFile,
      databasePath: paths.databaseFile,
      projectId: null,
      gitignore: 'skipped',
      ...(config ? { config } : {}),
    };
  }

  const name = options.name?.trim() || defaultProjectName(projectRoot);
  const config = createDefaultConfig({
    name,
    rootPath: projectRoot,
    provider: options.provider ?? 'none',
    model: options.model,
    baseUrl: options.baseUrl,
    debounceMs: options.debounceMs,
    maxFileSizeKb: options.maxFileSizeKb,
    maxDiffKb: options.maxDiffKb,
    timeoutMs: options.timeoutMs,
  });

  writeConfig(projectRoot, config);
  logger.success('Configuração criada em .codeanchor/config.json');

  const databaseExisted = existsSync(paths.databaseFile);
  const opened = openDatabase(paths.databaseFile);
  let projectId: string | null = null;
  try {
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name, rootPath: projectRoot });
    projectId = project.id;
  } finally {
    opened.close();
  }

  logger.success(
    databaseExisted
      ? 'Banco local e migrations atualizados em .codeanchor/codeanchor.db'
      : 'Banco local criado em .codeanchor/codeanchor.db',
  );

  const gitignore = await ensureGitignoreEntry(projectRoot, options);
  reportGitignore(gitignore);

  logger.section('Pronto!');
  logger.info(`Projeto: ${config.project.name}`);
  logger.detail(`Provider de IA: ${config.llm.provider}`);
  if (config.llm.model) logger.detail(`Modelo: ${config.llm.model}`);
  if (config.llm.baseUrl) logger.detail(`Endpoint: ${config.llm.baseUrl}`);
  logger.detail(`Caminhos observados: ${config.watch.paths.join(', ')}`);
  logger.detail(
    `Vigia: debounce ${config.watch.debounceMs} ms · arquivos até ${config.watch.maxFileSizeKb} KB · diff até ${config.git.maxDiffKb} KB`,
  );
  logger.blank();
  logger.hint('Próximo passo: rode "codeanchor start" para subir a API em http://localhost:4317');

  return {
    status: options.force ? 'reinitialized' : 'created',
    projectRoot,
    configPath: paths.configFile,
    databasePath: paths.databaseFile,
    projectId,
    gitignore,
    config,
  };
}

async function ensureGitignoreEntry(
  projectRoot: string,
  options: InitOptions,
): Promise<GitignoreStatus> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return 'missing';

  const content = readFileSync(gitignorePath, 'utf8');
  if (hasCodeAnchorEntry(content)) return 'present';

  let approved = options.yes === true;

  if (!approved) {
    const question = 'Adicionar .codeanchor/ ao .gitignore do projeto?';
    if (options.confirm) {
      approved = await options.confirm(question);
    } else if (stdin.isTTY) {
      approved = await askYesNo(question);
    } else {
      return 'skipped';
    }
  }

  if (!approved) return 'skipped';

  const separator = content.trim().length === 0 ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(
    gitignorePath,
    `${separator}# CodeAnchor (configuração e banco locais)\n.codeanchor/\n`,
    'utf8',
  );
  return 'added';
}

function hasCodeAnchorEntry(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) => line.trim().replace(/^\/+|\/+$/g, '') === '.codeanchor');
}

function reportGitignore(status: GitignoreStatus): void {
  switch (status) {
    case 'added':
      logger.success('Adicionado .codeanchor/ ao .gitignore.');
      break;
    case 'present':
      logger.info('.gitignore já ignora .codeanchor/.');
      break;
    case 'missing':
      logger.hint(
        'Nenhum .gitignore encontrado. Se usar Git, adicione ".codeanchor/" manualmente.',
      );
      break;
    case 'skipped':
      logger.warn('O .gitignore não foi alterado. Adicione ".codeanchor/" manualmente.');
      break;
  }
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} (s/N) `)).trim().toLowerCase();
    return ['s', 'sim', 'y', 'yes'].includes(answer);
  } finally {
    rl.close();
  }
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
