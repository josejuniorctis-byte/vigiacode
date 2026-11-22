import { existsSync } from 'node:fs';
import path from 'node:path';
import { countDiffStats } from '../ai/index.js';
import { configExists, readConfig, resolveConfigPaths } from '../config.js';
import {
  applyMigrations,
  findProjectByRootPath,
  listChangeEvents,
  openDatabase,
  type ChangeEventLayer,
} from '../db/index.js';
import { logger } from '../utils/logger.js';

export interface LogOptions {
  cwd: string;
  limit?: number | undefined;
  layer?: ChangeEventLayer | undefined;
}

/** `vigiacode log`: últimos eventos com resumo (e diff truncado). */
export async function runLog(options: LogOptions): Promise<void> {
  const projectRoot = path.resolve(options.cwd);
  logger.intro('VigiaCode · log');

  if (!configExists(projectRoot)) {
    logger.error('Este projeto ainda não foi inicializado.');
    logger.hint('Rode "vigiacode init" na raiz do projeto.');
    process.exitCode = 1;
    return;
  }

  const config = readConfig(projectRoot);
  const paths = resolveConfigPaths(projectRoot, config.database.file);

  if (!existsSync(paths.databaseFile)) {
    logger.error('Banco local não encontrado.');
    logger.hint('Rode "vigiacode init" para criar o banco e aplicar as migrations.');
    process.exitCode = 1;
    return;
  }

  const opened = openDatabase(paths.databaseFile);
  try {
    applyMigrations(opened.db);

    const project = findProjectByRootPath(opened.db, projectRoot);
    if (!project) {
      logger.error('Projeto não encontrado no banco local.');
      logger.hint('Rode "vigiacode init" novamente.');
      process.exitCode = 1;
      return;
    }

    const events = listChangeEvents(opened.db, project.id, {
      limit: options.limit ?? 20,
      layer: options.layer,
    });

    if (events.length === 0) {
      logger.info('Nenhum evento registrado ainda.');
      logger.hint('Rode "vigiacode start" e edite um arquivo para começar.');
      logger.blank();
      return;
    }

    const filter = options.layer ? ` · camada ${options.layer}` : '';
    logger.info(`${events.length} evento(s)${filter} — mais recentes primeiro`);
    logger.blank();

    for (const event of events) {
      const stats = countDiffStats(event.diff);
      const statsLabel = event.diff.length > 0 ? ` · +${stats.additions} −${stats.deletions}` : '';
      const truncated = event.diffTruncated ? ' · diff truncado' : '';
      const batch = event.batchId ? ` · lote ${event.batchId.slice(0, 8)}` : '';

      logger.info(
        `${formatTimestamp(event.createdAt)} · [${event.layer}] ${event.filePath} · ${event.changeType}${statsLabel}${truncated}${batch}`,
      );
      logger.detail(`Resumo: ${event.summary ?? '(resumo pendente)'}`);
    }

    logger.blank();
    logger.hint('Detalhes completos (com diff): GET /api/events/<id>');
  } finally {
    opened.close();
  }
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
