import path from 'node:path';
import { createProvider, type LLMProvider } from '../ai/index.js';
import { Architect } from '../architect/index.js';
import { createBindingsScanner } from '../bindings/index.js';
import type { VigiaCodeConfig } from '../config.js';
import {
  countRoadmapItems,
  findRoadmapItem,
  listRoadmapItems,
  updateRoadmapStatus,
  type RoadmapItemView,
} from '../db/index.js';
import type { RoadmapKind, RoadmapPriority, RoadmapStatus } from '../db/schema.js';
import { loadProjectEnv } from '../utils/env.js';
import { logger } from '../utils/logger.js';
import { openProject } from './bindings.js';

export interface ArchitectGenerateOptions {
  cwd: string;
  /** Pula o scan completo e usa o estado atual do banco. */
  noScan?: boolean | undefined;
}

export interface ArchitectListOptions {
  cwd: string;
  status?: RoadmapStatus | undefined;
  kind?: RoadmapKind | undefined;
  priority?: RoadmapPriority | undefined;
  module?: string | undefined;
  limit?: number | undefined;
}

export interface ArchitectPlanOptions {
  cwd: string;
  objective: string;
}

export interface ArchitectDoneOptions {
  cwd: string;
  id: string;
  note?: string | undefined;
}

/** `vigiacode architect generate`: scan + geradores determinísticos. */
export async function runArchitectGenerate(options: ArchitectGenerateOptions): Promise<void> {
  logger.intro('VigiaCode · architect generate');
  const envLoad = loadProjectEnv(path.resolve(options.cwd));
  if (envLoad.loaded.length > 0) {
    logger.detail(`.vigiacode/.env carregado (${envLoad.loaded.length} variável(is)).`);
  }

  const context = openProject(options.cwd);
  if (!context) return;

  try {
    let scanId: string | null = null;
    if (!options.noScan) {
      const scanner = createBindingsScanner({
        db: context.opened.db,
        project: context.project,
        config: context.config,
        provider: createSemanticProvider(context.config),
      });
      const scan = await scanner.scan({ trigger: 'manual' });
      scanId = scan?.scan.id ?? null;
      if (scan) {
        logger.detail(
          `Amarrações: ${scan.summary.red}🔴 ${scan.summary.yellow}🟡 ${scan.summary.green}🟢`,
        );
      }
    }

    const architect = new Architect({
      db: context.opened.db,
      project: context.project,
      config: context.config,
    });
    const result = architect.generate({ scanId });
    const counts = countRoadmapItems(context.opened.db, context.project.id);

    logger.blank();
    logger.info(
      `Roadmap: ${result.created} criado(s) · ${result.reopened} reaberto(s) · ${result.closed} fechado(s)`,
    );
    logger.detail(
      `Por tipo — binding: ${result.byKind.binding.created}, debt: ${result.byKind.debt.created}, test: ${result.byKind.test.created}`,
    );
    logger.detail(
      `Abertos — todo: ${counts.todo}, doing: ${counts.doing}, blocked: ${counts.blocked}, done: ${counts.done}`,
    );

    const next = result.items
      .filter(
        (item) => item.status === 'todo' && (item.priority === 'p0' || item.priority === 'p1'),
      )
      .slice(0, 10);
    if (next.length > 0) {
      logger.blank();
      logger.section('Prioridades');
      for (const item of next) logger.info(formatItemLine(item));
    }
  } finally {
    context.opened.close();
  }
}

/** `vigiacode architect list`: kanban em texto com filtros. */
export async function runArchitectList(options: ArchitectListOptions): Promise<void> {
  logger.intro('VigiaCode · architect list');
  const context = openProject(options.cwd);
  if (!context) return;

  try {
    const items = listRoadmapItems(context.opened.db, context.project.id, {
      status: options.status,
      kind: options.kind,
      priority: options.priority,
      module: options.module,
      limit: options.limit ?? 100,
    });
    if (items.length === 0) {
      logger.info('Roadmap vazio com esses filtros.');
      logger.hint('vigiacode architect generate  # monta o roadmap a partir do código');
      return;
    }

    const counts = countRoadmapItems(context.opened.db, context.project.id);
    logger.detail(
      `todo ${counts.todo} · doing ${counts.doing} · blocked ${counts.blocked} · done ${counts.done}`,
    );
    logger.blank();
    for (const item of items) {
      logger.info(formatItemLine(item));
      if (item.module) logger.detail(`módulo ${item.module} · ${item.sourceRef ?? 'manual'}`);
      if (item.evidence.length > 0) logger.detail(`evidência: ${item.evidence[0]}`);
    }
  } finally {
    context.opened.close();
  }
}

/** `vigiacode architect plan "<objetivo>"`: heurístico ou IA. */
export async function runArchitectPlan(options: ArchitectPlanOptions): Promise<void> {
  logger.intro('VigiaCode · architect plan');
  const context = openProject(options.cwd);
  if (!context) return;

  try {
    const provider = createSemanticProvider(context.config);
    const architect = new Architect({
      db: context.opened.db,
      project: context.project,
      config: context.config,
      provider,
      logger: {
        info: (message: string) => logger.detail(message),
        warn: (message: string) => logger.warn(message),
      },
    });
    const result = await architect.plan(options.objective);

    logger.event(
      `Plano gerado por ${result.heuristic ? 'heurística local' : `IA (${result.provider})`}`,
    );
    logger.detail(`Objetivo: ${result.objective}`);
    logger.blank();
    for (const item of result.items) {
      logger.info(formatItemLine(item));
      for (const criterion of item.checklist) logger.detail(`☐ ${criterion.label}`);
    }
    logger.blank();
    logger.hint('Acompanhe e marque como concluído: vigiacode architect list / done <id>');
  } finally {
    context.opened.close();
  }
}

/** `vigiacode architect done <id>`: conclui um item manualmente. */
export async function runArchitectDone(options: ArchitectDoneOptions): Promise<void> {
  logger.intro('VigiaCode · architect done');
  const context = openProject(options.cwd);
  if (!context) return;

  try {
    const item = findRoadmapItem(context.opened.db, options.id);
    if (!item || item.projectId !== context.project.id) {
      logger.error(`Item "${options.id}" não encontrado.`);
      process.exitCode = 1;
      return;
    }
    const updated = updateRoadmapStatus(
      context.opened.db,
      options.id,
      'done',
      options.note ?? 'Concluído manualmente.',
    );
    if (!updated) {
      logger.error('Não foi possível atualizar o item.');
      process.exitCode = 1;
      return;
    }
    logger.success(`Concluído: ${updated.title}`);
  } finally {
    context.opened.close();
  }
}

function createSemanticProvider(config: VigiaCodeConfig): LLMProvider | null {
  if (config.llm.provider === 'none') return null;
  try {
    return createProvider(config.llm);
  } catch (error) {
    logger.warn(
      `IA indisponível; usando o modo heurístico: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function formatItemLine(item: RoadmapItemView): string {
  const icon =
    item.status === 'done'
      ? '✅'
      : item.status === 'doing'
        ? '🔵'
        : item.status === 'blocked'
          ? '⛔'
          : '☐';
  return `${icon} [${item.priority}] ${item.kind} · ${item.title} (${item.id.slice(0, 8)})`;
}
