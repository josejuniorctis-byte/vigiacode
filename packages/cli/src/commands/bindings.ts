import { existsSync } from 'node:fs';
import path from 'node:path';
import { createProvider, type LLMProvider } from '../ai/index.js';
import { createBindingsScanner } from '../bindings/index.js';
import type { MatrixCell, MatrixRow } from '../bindings/types.js';
import { configExists, readConfig, resolveConfigPaths, type VigiaCodeConfig } from '../config.js';
import {
  applyMigrations,
  findProjectByRootPath,
  listBindings,
  listBindingScans,
  openDatabase,
  summarizeBindings,
  type VigiaCodeDatabase,
  type OpenedDatabase,
} from '../db/index.js';
import type { Binding, BindingLayer, BindingStatus, Project } from '../db/schema.js';
import { loadProjectEnv } from '../utils/env.js';
import { logger } from '../utils/logger.js';

export type FailOn = 'red' | 'yellow' | 'none';

export interface OpenedProject {
  opened: OpenedDatabase;
  config: VigiaCodeConfig;
  project: Project;
}

export interface BindingsScanOptions {
  cwd: string;
  failOn?: FailOn | undefined;
}

export interface BindingsListOptions {
  cwd: string;
  status?: BindingStatus | undefined;
  layer?: BindingLayer | undefined;
  rule?: string | undefined;
  entity?: string | undefined;
  search?: string | undefined;
  resolved?: boolean | undefined;
  limit?: number | undefined;
}

export interface BindingsMatrixOptions {
  cwd: string;
}

/** `vigiacode bindings scan`: scan completo com exit code para CI. */
export async function runBindingsScan(options: BindingsScanOptions): Promise<void> {
  logger.intro('VigiaCode · bindings scan');
  const envLoad = loadProjectEnv(path.resolve(options.cwd));
  if (envLoad.loaded.length > 0) {
    logger.detail(`.vigiacode/.env carregado (${envLoad.loaded.length} variável(is)).`);
  }

  const context = openProject(options.cwd);
  if (!context) return;

  const provider = createSemanticProvider(context.config);
  const scanner = createBindingsScanner({
    db: context.opened.db,
    project: context.project,
    config: context.config,
    provider,
    logger: {
      info: (message: string) => logger.detail(message),
      warn: (message: string) => logger.warn(message),
    },
  });

  try {
    // Progresso a cada ~10% para repositórios grandes.
    logger.event('Analisando…');
    let lastPercent = -1;
    const result = await scanner.scan({
      trigger: 'manual',
      onProgress: (progress) => {
        const percent =
          progress.total === 0 ? 100 : Math.floor((progress.scanned / progress.total) * 100);
        if (percent < lastPercent + 10 && progress.scanned < progress.total) return;
        lastPercent = percent;
        logger.detail(
          `Scan ${percent}% · ${progress.scanned}/${progress.total} arquivo(s) — ${progress.file}`,
        );
      },
    });
    if (!result) {
      logger.info('Nenhum arquivo suportado encontrado para analisar.');
      return;
    }

    const summary = result.summary;
    logger.blank();
    logger.info(
      `${result.filesScanned} arquivo(s) · ${summary.red}🔴 ${summary.yellow}🟡 ${summary.green}🟢 · saúde ${summary.healthPercent}%`,
    );
    logger.detail(
      `Novas: ${result.created.length} · resolvidas: ${result.resolved.length} · ticket: ${result.scan.id.slice(0, 8)}`,
    );

    const active = listBindings(context.opened.db, context.project.id, {
      limit: 200,
    }).filter((binding) => binding.status !== 'green');

    if (active.length === 0) {
      logger.success('Nenhuma amarração pendente. 🎉');
    } else {
      logger.blank();
      logger.section('Pendências');
      for (const binding of active.slice(0, 25)) {
        logger.info(formatBindingLine(binding));
      }
      if (active.length > 25) {
        logger.detail(`… e mais ${active.length - 25} pendência(s).`);
      }
    }

    logger.blank();
    logger.hint('Detalhes: vigiacode bindings list · matriz: vigiacode bindings matrix');

    applyExitCode(options.failOn ?? 'red', summary.red, summary.yellow);
  } finally {
    context.opened.close();
  }
}

/** `vigiacode bindings list`: lista filtrável com cores. */
export async function runBindingsList(options: BindingsListOptions): Promise<void> {
  logger.intro('VigiaCode · bindings list');
  const context = openProject(options.cwd);
  if (!context) return;

  try {
    const bindings = listBindings(context.opened.db, context.project.id, {
      status: options.status,
      layer: options.layer,
      rule: options.rule,
      entity: options.entity,
      search: options.search,
      includeResolved: options.resolved ?? false,
      limit: options.limit ?? 50,
    });
    const summary = summarizeBindings(context.opened.db, context.project.id);

    logger.info(
      `${bindings.length} amarração(ões) listada(s) · ${summary.red}🔴 ${summary.yellow}🟡 ${summary.green}🟢`,
    );

    if (bindings.length === 0) {
      logger.blank();
      logger.info('Nada por aqui com esses filtros.');
      logger.hint('vigiacode bindings scan  # roda a análise completa');
      return;
    }

    logger.blank();
    for (const binding of bindings) {
      logger.info(formatBindingLine(binding));
      const refs = [
        binding.frontRef && `front ${binding.frontRef}`,
        binding.backRef && `back ${binding.backRef}`,
        binding.dbRef && `db ${binding.dbRef}`,
      ]
        .filter((item): item is string => Boolean(item))
        .join(' · ');
      if (refs.length > 0) logger.detail(refs);
      if (binding.suggestion) logger.detail(`→ ${binding.suggestion}`);
    }
  } finally {
    context.opened.close();
  }
}

/** `vigiacode bindings matrix`: tabela entidade × camadas. */
export async function runBindingsMatrix(options: BindingsMatrixOptions): Promise<void> {
  logger.intro('VigiaCode · bindings matrix');
  const context = openProject(options.cwd);
  if (!context) return;

  try {
    const scans = listBindingScans(context.opened.db, context.project.id, 1);
    const scan = scans[0];
    if (!scan?.matrixJson) {
      logger.warn('Nenhum scan registrado ainda.');
      logger.hint('vigiacode bindings scan');
      return;
    }

    let matrix: { entities?: MatrixRow[]; totals?: Record<string, number> } | null = null;
    try {
      matrix = JSON.parse(scan.matrixJson) as {
        entities?: MatrixRow[];
        totals?: Record<string, number>;
      };
    } catch {
      matrix = null;
    }
    const rows = matrix?.entities ?? [];
    if (rows.length === 0) {
      logger.info('Nenhuma entidade detectada.');
      return;
    }

    logger.detail(
      `scan ${scan.id.slice(0, 8)} · ${scan.startedAt} · ${scan.filesScanned} arquivo(s)`,
    );
    logger.blank();
    printMatrixTable(rows);

    const totals = matrix?.totals ?? {};
    logger.blank();
    logger.info(
      `${totals.integrated ?? 0} integrada(s) · ${totals.partial ?? 0} parcial(is) · ${totals.local ?? 0} só local · ${totals.missing ?? 0} faltando`,
    );
  } finally {
    context.opened.close();
  }
}

export function openProject(cwd: string): OpenedProject | null {
  const projectRoot = path.resolve(cwd);
  if (!configExists(projectRoot)) {
    logger.error('Este projeto ainda não foi inicializado.');
    logger.hint('Rode "vigiacode init" na raiz do projeto.');
    process.exitCode = 1;
    return null;
  }

  const config = readConfig(projectRoot);
  const paths = resolveConfigPaths(projectRoot, config.database.file);
  if (!existsSync(paths.databaseFile)) {
    logger.error('Banco local não encontrado.');
    logger.hint('Rode "vigiacode init" para criar o banco e aplicar as migrations.');
    process.exitCode = 1;
    return null;
  }

  const opened = openDatabase(paths.databaseFile);
  try {
    applyMigrations(opened.db);
    const project = findProjectByRootPath(opened.db, projectRoot);
    if (!project) {
      logger.error('Projeto não encontrado no banco local.');
      logger.hint('Rode "vigiacode init" novamente.');
      opened.close();
      process.exitCode = 1;
      return null;
    }
    return { opened, config, project };
  } catch (error) {
    opened.close();
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return null;
  }
}

function createSemanticProvider(config: VigiaCodeConfig): LLMProvider | null {
  if (config.llm.provider === 'none') return null;
  try {
    return createProvider(config.llm);
  } catch (error) {
    logger.warn(
      `IA indisponível para o matcher semântico: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function applyExitCode(failOn: FailOn, red: number, yellow: number): void {
  if (failOn === 'none') return;
  const failing = failOn === 'yellow' ? red + yellow : red;
  if (failing > 0) {
    logger.error(
      `Falhando o scan: ${failing} amarração(ões) ${failOn === 'yellow' ? '🟡/🔴' : '🔴'} (--fail-on ${failOn}).`,
    );
    process.exitCode = 1;
  } else {
    logger.success('Scan dentro do limite configurado.');
  }
}

function formatBindingLine(binding: Binding): string {
  const icon = binding.status === 'red' ? '🔴' : binding.status === 'yellow' ? '🟡' : '🟢';
  const resolved = binding.resolvedAt ? ' (resolvida)' : '';
  const accepted = binding.accepted ? ' (aceita)' : '';
  return `${icon} [${binding.ruleId}] ${binding.entity}.${binding.field || '*'}${resolved}${accepted} — ${binding.message}`;
}

function printMatrixTable(rows: MatrixRow[]): void {
  const header = ['ENTIDADE', 'FRONT', 'BACK', 'BANCO', 'STATUS'];
  const widths = [28, 8, 8, 8, 18];
  const line = (cells: string[]): string =>
    cells.map((cell, index) => pad(cell, widths[index] ?? 12)).join(' ');

  logger.event(line(header));
  logger.event(widths.map((width) => '─'.repeat(width)).join(' '));
  for (const row of rows) {
    logger.event(
      line([
        truncate(row.rawName || row.entity, widths[0]!),
        cellIcon(row.front),
        cellIcon(row.back),
        cellIcon(row.db),
        row.link,
      ]),
    );
  }
}

function cellIcon(cell: MatrixCell): string {
  switch (cell.state) {
    case 'integrated':
      return '✅';
    case 'partial':
      return '🟡';
    case 'local':
      return '⬜';
    case 'missing':
      return '❌';
    default:
      return '·';
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ');
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

/** Repositório exposto apenas para tipagem em testes de comando. */
export type { VigiaCodeDatabase };
