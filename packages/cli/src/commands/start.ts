import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createSummarizer } from '../ai/index.js';
import {
  CODEANCHOR_API_KEY_ENV,
  configExists,
  readConfig,
  resolveConfigPaths,
  type CodeAnchorConfig,
} from '../config.js';
import {
  applyMigrations,
  findProjectByRootPath,
  openDatabase,
  registerProject,
  type OpenedDatabase,
} from '../db/index.js';
import { GitRepository, startHeadWatcher, syncSnapshot } from '../git/index.js';
import { createServer, resolveWebDistPath } from '../server/index.js';
import { EventHub } from '../server/hub.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../version.js';
import { ChangeRecorder, startWatcher, type WatcherHandle } from '../watcher/index.js';

export interface StartOptions {
  /** Raiz do projeto do usuário (normalmente process.cwd()). */
  cwd: string;
  port?: number | undefined;
  host?: string | undefined;
  /** `false` desliga o vigia (flag --no-watch). */
  watch?: boolean | undefined;
}

export interface RunningServer {
  app: FastifyInstance;
  opened: OpenedDatabase;
  url: string;
  host: string;
  port: number;
  watcher: WatcherHandle | null;
  recorder: ChangeRecorder;
  close(): Promise<void>;
}

/**
 * `codeanchor start`: valida o init, abre o banco, sobe o Fastify, inicia o vigia
 * e serve o build do front-end quando ele existe.
 *
 * Retorna `null` quando não foi possível iniciar (a mensagem já foi impressa).
 */
export async function runStart(options: StartOptions): Promise<RunningServer | null> {
  const projectRoot = path.resolve(options.cwd);
  const paths = resolveConfigPaths(projectRoot);

  if (!configExists(projectRoot)) {
    logger.error('Este projeto ainda não foi inicializado.');
    logger.detail(`Esperado: ${toPosix(path.relative(projectRoot, paths.configFile))}`);
    logger.hint('Rode "codeanchor init" na raiz do projeto e depois "codeanchor start".');
    process.exitCode = 1;
    return null;
  }

  const config = readConfigOrReport(projectRoot);
  if (!config) {
    process.exitCode = 1;
    return null;
  }

  const databasePaths = resolveConfigPaths(projectRoot, config.database.file);
  if (!existsSync(databasePaths.databaseFile)) {
    logger.error('Banco local não encontrado.');
    logger.detail(`Esperado: ${toPosix(path.relative(projectRoot, databasePaths.databaseFile))}`);
    logger.hint('Rode "codeanchor init" para criar o banco e aplicar as migrations.');
    process.exitCode = 1;
    return null;
  }

  const opened = openDatabase(databasePaths.databaseFile);
  try {
    applyMigrations(opened.db);
  } catch (error) {
    opened.close();
    logger.error(
      `Não foi possível preparar o banco: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return null;
  }

  let project = findProjectByRootPath(opened.db, projectRoot);
  if (!project) {
    project = registerProject(opened.db, {
      name: config.project.name,
      rootPath: projectRoot,
    });
    logger.warn('O projeto não estava registrado no banco local; registro refeito.');
  }

  const hub = new EventHub();
  const summarizer = createSummarizer(config.llm);
  const git = await GitRepository.open(projectRoot);
  let headHash: string | null = null;

  if (git) {
    headHash = await git.headHash();
    const initialSnapshot = await syncSnapshot(opened.db, project.id, git);
    if (initialSnapshot) {
      logger.detail(`Snapshot inicial do Git: ${initialSnapshot.commitHash.slice(0, 7)}`);
    }
  } else {
    logger.warn('Este projeto não é um repositório Git; os eventos serão registrados sem diff.');
    logger.hint('Rode "git init" (e faça um commit) para capturar diffs nas próximas mudanças.');
  }

  if (config.llm.provider === 'byok' && !process.env[CODEANCHOR_API_KEY_ENV]) {
    logger.warn(`${CODEANCHOR_API_KEY_ENV} não definida; os resumos usarão o heurístico local.`);
  }

  const recorder = new ChangeRecorder({
    db: opened.db,
    project,
    config,
    git,
    summarizer,
    hub,
  });

  const headWatcher = startHeadWatcher({
    db: opened.db,
    projectId: project.id,
    git,
    onSnapshot: (snapshot) => {
      logger.detail(`Novo snapshot Git: ${snapshot.commitHash.slice(0, 7)}`);
    },
    onError: (error: unknown) => {
      logger.warn(
        `Falha ao verificar o HEAD do Git: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });

  const port = options.port ?? config.server.port;
  const host = options.host ?? config.server.host;
  const webDistPath = resolveWebDistPath();

  const app = await createServer({
    db: opened.db,
    project,
    version: VERSION,
    webDistPath,
    hub,
  });

  let watcher: WatcherHandle | null = null;

  const close = async (): Promise<void> => {
    headWatcher.close();
    if (watcher) {
      try {
        await watcher.close();
      } catch (error) {
        logger.warn(
          `Falha ao encerrar o vigia: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await recorder.queue.drain(3_000);
    try {
      await app.close();
    } finally {
      opened.close();
    }
  };

  try {
    await app.listen({ port, host });
  } catch (error) {
    await close();
    process.exitCode = 1;

    if (hasErrorCode(error, 'EADDRINUSE')) {
      logger.error(`A porta ${port} já está em uso.`);
      logger.hint(`Escolha outra porta: codeanchor start --port ${port + 1}`);
    } else if (hasErrorCode(error, 'EACCES')) {
      logger.error(`Sem permissão para escutar na porta ${port}.`);
      logger.hint('Use uma porta acima de 1024 ou rode com permissões adequadas.');
    } else {
      logger.error(
        `Não foi possível iniciar o servidor: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }

  if (options.watch !== false) {
    try {
      watcher = await startWatcher({
        projectRoot,
        config: config.watch,
        onBatch: async (changes) => {
          await recorder.handleBatch(changes);
        },
        onError: (error: unknown) => {
          logger.error(`Vigia: ${error instanceof Error ? error.message : String(error)}`);
        },
      });
    } catch (error) {
      logger.warn(
        `Não foi possível iniciar o vigia: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      logger.hint('A API continua ativa, mas nenhuma mudança será capturada.');
    }
  }

  const displayHost =
    host === '0.0.0.0' || host === '::' || host === '::1' || host === '127.0.0.1'
      ? 'localhost'
      : host;
  const url = `http://${displayHost}:${port}`;

  logger.intro('CodeAnchor iniciado');
  logger.detail(`Projeto: ${project.name}`);
  logger.detail(`API:     ${url}/api/health`);
  logger.detail(
    `Web:     ${webDistPath ? url : 'ainda não buildada (rode "pnpm build" na raiz do monorepo)'}`,
  );
  logger.detail(`Banco:   ${toPosix(path.relative(projectRoot, databasePaths.databaseFile))}`);
  logger.detail(
    `IA:      ${config.llm.provider}${
      config.llm.provider === 'none'
        ? ' (resumo heurístico local)'
        : ` · ${config.llm.model ?? 'modelo padrão'}`
    }`,
  );
  logger.detail(`Git:     ${headHash ? headHash.slice(0, 7) : 'não detectado (eventos sem diff)'}`);
  logger.detail(
    watcher
      ? `Vigia:   ativo · ${watcher.paths.length} caminho(s) · debounce ${config.watch.debounceMs} ms`
      : 'Vigia:   desativado (--no-watch)',
  );
  logger.blank();
  logger.hint('Pressione Ctrl+C para encerrar.');

  return { app, opened, url, host, port, watcher, recorder, close };
}

/** Executa o comando e mantém o processo vivo com shutdown gracioso. */
export async function runStartCommand(options: StartOptions): Promise<void> {
  const running = await runStart(options);
  if (!running) return;

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.blank();
    logger.info(`Encerrando o CodeAnchor (${signal})...`);
    try {
      await running.close();
    } catch (error) {
      logger.error(
        `Falha ao encerrar o servidor: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    logger.success('Servidor encerrado.');
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function readConfigOrReport(projectRoot: string): CodeAnchorConfig | null {
  try {
    return readConfig(projectRoot);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    logger.hint('Rode "codeanchor init --force" para recriar a configuração.');
    return null;
  }
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
