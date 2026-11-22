import { existsSync } from 'node:fs';
import path from 'node:path';
import type { LLMProvider } from '../ai/index.js';
import { walkProjectFiles } from '../bindings/scanner.js';
import { isSupportedBindingFile } from '../bindings/classify.js';
import type { VigiaCodeConfig } from '../config.js';
import {
  closeGeneratedItemsNotSeen,
  listFrequentChangedFiles,
  listRoadmapItems,
  upsertGeneratedItem,
  type RoadmapItemView,
} from '../db/roadmap-repository.js';
import type { VigiaCodeDatabase } from '../db/client.js';
import { listBindings } from '../db/bindings-repository.js';
import type { Binding, Project, RoadmapKind } from '../db/schema.js';
import { baseNameOf, dirOf, extensionOf, moduleOfPath } from './module.js';
import { collectTodoComments, type TodoComment } from './todos.js';

export interface ArchitectOptions {
  db: VigiaCodeDatabase;
  project: Project;
  config: VigiaCodeConfig;
  provider?: LLMProvider | null;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
  };
}

export interface RoadmapGenerationOptions {
  /** Lista incremental do vigia; quando ausente, caminha o projeto inteiro. */
  changedFiles?: readonly string[] | undefined;
  scanId?: string | null;
}

export interface RoadmapKindCounts {
  created: number;
  reopened: number;
  closed: number;
}

export interface RoadmapGenerationResult {
  created: number;
  reopened: number;
  closed: number;
  byKind: Record<RoadmapKind, RoadmapKindCounts>;
  scanId: string | null;
  items: RoadmapItemView[];
}

export interface ArchitectPlanResult {
  provider: string;
  heuristic: boolean;
  objective: string;
  items: RoadmapItemView[];
}

const TEST_FILE_PATTERN =
  /(\.(test|spec)\.[a-z]+$)|(^test_.*\.py$)|(_test\.py$)|(Test\.java$)|(Tests\.java$)|(IT\.java$)/i;

/**
 * O Arquiteto mantém o roadmap derivado do código real. Tudo aqui é
 * determinístico (sem IA): amarrações 🔴, TODOs e arquivos alterados sem teste.
 */
export class Architect {
  private readonly db: VigiaCodeDatabase;
  private readonly project: Project;
  private readonly config: VigiaCodeConfig;
  private readonly provider: LLMProvider | null;
  private readonly logger: ArchitectOptions['logger'];

  constructor(options: ArchitectOptions) {
    this.db = options.db;
    this.project = options.project;
    this.config = options.config;
    this.provider = options.provider ?? null;
    this.logger = options.logger;
  }

  generate(options: RoadmapGenerationOptions = {}): RoadmapGenerationResult {
    const result: RoadmapGenerationResult = {
      created: 0,
      reopened: 0,
      closed: 0,
      byKind: {
        feature: { created: 0, reopened: 0, closed: 0 },
        fix: { created: 0, reopened: 0, closed: 0 },
        debt: { created: 0, reopened: 0, closed: 0 },
        binding: { created: 0, reopened: 0, closed: 0 },
        test: { created: 0, reopened: 0, closed: 0 },
        doc: { created: 0, reopened: 0, closed: 0 },
      },
      scanId: options.scanId ?? null,
      items: [],
    };

    this.syncBindingItems(result, options.scanId ?? null);
    this.syncTodoItems(result, options.changedFiles);
    if (!options.changedFiles) this.syncTestItems(result);

    return result;
  }

  private syncBindingItems(result: RoadmapGenerationResult, scanId: string | null): void {
    const red = listBindings(this.db, this.project.id, { status: 'red', limit: 1000 });
    const groups = new Map<string, Binding[]>();
    for (const binding of red) {
      const bucket = groups.get(binding.entity) ?? [];
      bucket.push(binding);
      groups.set(binding.entity, bucket);
    }

    const active = new Set<string>();
    for (const [entity, bindings] of groups) {
      active.add(entity);
      const module = moduleFromRefs(bindings);
      const fields = bindings.map((binding) => binding.field).filter(Boolean);
      const refs = uniqueRefs(bindings);
      const evidence = [
        ...refs.map((ref) => `referência: ${ref}`),
        ...(scanId ? [`scan: ${scanId}`] : []),
      ];
      const upsert = upsertGeneratedItem(this.db, {
        projectId: this.project.id,
        title: `Amarrar ${entity} entre as camadas`,
        description:
          bindings.length === 1
            ? (bindings[0]?.message ?? '')
            : `${bindings.length} campo(s) 🔴 pendentes: ${fields.join(', ')}.`,
        kind: 'binding',
        priority: 'p1',
        source: 'binding',
        sourceRef: entity,
        module,
        evidence,
        checklist: [
          checklistEntry(
            'Front-end presente',
            bindings.some((binding) => binding.frontRef),
          ),
          checklistEntry(
            'Back-end presente',
            bindings.some((binding) => binding.backRef),
          ),
          checklistEntry(
            'Banco presente',
            bindings.some((binding) => binding.dbRef),
          ),
          checklistEntry('Sem pendências 🔴 nesta entidade', false),
        ],
        links: bindings.map((binding) => ({
          bindingId: binding.id,
          filePath: binding.frontRef ?? binding.backRef ?? binding.dbRef ?? null,
          commitSha: null,
        })),
      });
      recordUpsert(result, 'binding', upsert);
      result.items.push(upsert.item);
    }

    const closed = closeGeneratedItemsNotSeen(
      this.db,
      this.project.id,
      'binding',
      active,
      scanId
        ? `Evidência: scan ${scanId} não encontrou amarrações 🔴 para esta entidade.`
        : 'Evidência: entidade sem amarrações 🔴 no scan atual.',
    );
    recordClosed(result, 'binding', closed.length);
    result.items.push(...closed);
  }

  private syncTodoItems(result: RoadmapGenerationResult, changedFiles?: readonly string[]): void {
    const active = new Set<string>();
    if (this.config.architect.todoComments === false) {
      const closed = closeGeneratedItemsNotSeen(
        this.db,
        this.project.id,
        'debt',
        active,
        'Evidência: architect.todoComments desligado no config.',
      );
      recordClosed(result, 'debt', closed.length);
      result.items.push(...closed);
      return;
    }

    const comments = this.collectTodoComments(changedFiles);
    for (const [module, group] of groupTodosByModule(comments)) {
      const sourceRef = `todo:${module}`;
      active.add(sourceRef);
      const counts = countMarkers(group);
      const priority = counts.urgent > 0 ? 'p2' : 'p3';
      const summary = markerSummary(counts);
      const upsert = upsertGeneratedItem(this.db, {
        projectId: this.project.id,
        title: `Zerar débitos ${summary} em ${module}`.slice(0, 160),
        description: [
          `${group.length} comentário(s) de dívida técnica no módulo ${module}.`,
          ...group.map(
            (comment) =>
              `- ${comment.marker} ${comment.file}:${comment.line} — ${comment.text || 'sem descrição'}`,
          ),
        ].join('\n'),
        kind: 'debt',
        priority,
        source: 'todo-comment',
        sourceRef,
        module,
        evidence: group.map(
          (comment) =>
            `${comment.marker} ${comment.file}:${comment.line} — ${comment.text || 'sem descrição'}`,
        ),
        checklist: [checklistEntry(`Zerar ${group.length} comentário(s) em ${module}`, false)],
        links: [...new Set(group.map((comment) => comment.file))].map((file) => ({
          bindingId: null,
          filePath: file,
          commitSha: null,
        })),
      });
      recordUpsert(result, 'debt', upsert);
      result.items.push(upsert.item);
    }

    const closed = closeGeneratedItemsNotSeen(
      this.db,
      this.project.id,
      'debt',
      active,
      'Evidência: comentário TODO/FIXME/HACK não existe mais no projeto.',
    );
    recordClosed(result, 'debt', closed.length);
    result.items.push(...closed);
  }

  /**
   * Em scan incremental, mescla os comentários dos arquivos alterados com os
   * já conhecidos (que vêm da evidência dos itens agrupados por módulo).
   */
  private collectTodoComments(changedFiles?: readonly string[]): TodoComment[] {
    if (!changedFiles) {
      return collectTodoComments({ projectRoot: this.project.rootPath, config: this.config });
    }
    const changed = new Set(changedFiles);
    const kept: TodoComment[] = [];
    const items = listRoadmapItems(this.db, this.project.id, {
      kind: 'debt',
      source: 'todo-comment',
      limit: 10_000,
    });
    for (const item of items) {
      for (const evidence of item.evidence) {
        const comment = parseTodoEvidence(evidence);
        if (comment && !changed.has(comment.file)) kept.push(comment);
      }
    }
    const fresh = collectTodoComments({
      projectRoot: this.project.rootPath,
      config: this.config,
      files: changedFiles,
    });
    return [...kept, ...fresh];
  }

  private syncTestItems(result: RoadmapGenerationResult): void {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const frequent = listFrequentChangedFiles(this.db, this.project.id, since, 3, 25);
    if (frequent.length === 0) return;

    const files = new Set(walkProjectFiles(this.project.rootPath, this.config));
    const active = new Set<string>();

    for (const changed of frequent) {
      if (!isCodeFile(changed.filePath) || TEST_FILE_PATTERN.test(changed.filePath)) continue;
      if (hasCorrespondingTest(changed.filePath, files, this.project.rootPath)) continue;

      active.add(changed.filePath);
      const upsert = upsertGeneratedItem(this.db, {
        projectId: this.project.id,
        title: `Criar teste para ${baseNameOf(changed.filePath)}`,
        description: `Arquivo alterado ${changed.changes}× nos últimos 30 dias sem teste correspondente.`,
        kind: 'test',
        priority: 'p2',
        source: 'git',
        sourceRef: changed.filePath,
        module: moduleOfPath(changed.filePath),
        evidence: [
          `alterações nos últimos 30 dias: ${changed.changes}`,
          `última alteração: ${changed.lastChangedAt}`,
        ],
        checklist: [
          checklistEntry('Teste correspondente criado', false),
          checklistEntry('Teste passa localmente', false),
        ],
        links: [{ bindingId: null, filePath: changed.filePath, commitSha: null }],
      });
      recordUpsert(result, 'test', upsert);
      result.items.push(upsert.item);
    }

    const closed = closeGeneratedItemsNotSeen(
      this.db,
      this.project.id,
      'test',
      active,
      'Evidência: teste correspondente encontrado ou arquivo não é mais frequente.',
    );
    recordClosed(result, 'test', closed.length);
    result.items.push(...closed);
  }

  /** Plano de execução para um objetivo (heurístico ou IA, conforme provider). */
  async plan(objective: string): Promise<ArchitectPlanResult> {
    const trimmed = objective.trim();
    if (trimmed.length === 0) throw new Error('Informe o objetivo do plano.');
    const heuristic = this.provider === null || this.provider.name === 'none';
    const steps = heuristic
      ? this.heuristicSteps(trimmed)
      : await this.aiSteps(trimmed, this.provider as LLMProvider);

    const slug = slugify(trimmed);
    const items: RoadmapItemView[] = [];
    for (const [index, step] of steps.entries()) {
      const item = upsertGeneratedItem(this.db, {
        projectId: this.project.id,
        title: step.title,
        description: [
          `Objetivo: ${trimmed}`,
          step.description,
          step.files.length > 0 ? `Arquivos prováveis: ${step.files.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        kind: 'feature',
        priority: step.priority,
        source: 'ai',
        sourceRef: `plan:${slug}:${index + 1}`,
        module: step.files[0] ? moduleOfPath(step.files[0]) : null,
        evidence: step.files.map((file) => `arquivo: ${file}`),
        checklist: step.criteria.map((criterion) => checklistEntry(criterion, false)),
        links: step.files.map((file) => ({ bindingId: null, filePath: file, commitSha: null })),
      }).item;
      items.push(item);
    }

    return {
      provider: heuristic ? 'none' : (this.provider?.name ?? 'none'),
      heuristic,
      objective: trimmed,
      items,
    };
  }

  private heuristicSteps(objective: string): PlanStep[] {
    const steps: PlanStep[] = [];
    const red = listBindings(this.db, this.project.id, { status: 'red', limit: 200 });
    const groups = new Map<string, Binding[]>();
    for (const binding of red) {
      const bucket = groups.get(binding.entity) ?? [];
      bucket.push(binding);
      groups.set(binding.entity, bucket);
    }
    for (const [entity, bindings] of [...groups.entries()].slice(0, 5)) {
      const files = uniqueRefs(bindings).map(stripLine);
      steps.push({
        title: `Fechar amarração de ${entity}`,
        description: `Corrigir ${bindings.length} campo(s) 🔴 entre front-end, back-end e banco antes de avançar em "${objective}".`,
        files: [...new Set(files)].slice(0, 5),
        criteria: [
          'Campo existe nas 3 camadas',
          `\`vigiacode bindings scan\` sem 🔴 para ${entity}`,
        ],
        priority: 'p1',
      });
    }

    const todos = collectTodoComments({
      projectRoot: this.project.rootPath,
      config: this.config,
    }).slice(0, 5);
    for (const comment of todos) {
      steps.push({
        title: `Resolver ${comment.marker} em ${baseNameOf(comment.file)}`,
        description: comment.text || `Dívida técnica anotada em ${comment.file}:${comment.line}.`,
        files: [comment.file],
        criteria: [
          `Comentário ${comment.marker} removido`,
          'Teste cobre o comportamento corrigido',
        ],
        priority: 'p2',
      });
    }

    if (steps.length === 0) {
      steps.push({
        title: `Planejar implementação de "${objective}"`,
        description:
          'Nenhuma amarração 🔴 nem TODO pendente; comece pelos arquivos do módulo principal.',
        files: [],
        criteria: ['Escopo escrito e revisado', 'Testes do fluxo principal criados'],
        priority: 'p2',
      });
    }

    steps.push({
      title: 'Validar o plano com o VigiaCode',
      description: 'Rodar scan completo e confirmar que o roadmap fechou os itens resolvidos.',
      files: [],
      criteria: [
        '`vigiacode bindings scan` limpo',
        '`vigiacode architect generate` sem itens p1 abertos',
      ],
      priority: 'p2',
    });

    return steps;
  }

  private async aiSteps(objective: string, provider: LLMProvider): Promise<PlanStep[]> {
    const red = listBindings(this.db, this.project.id, { status: 'red', limit: 30 });
    const todos = collectTodoComments({
      projectRoot: this.project.rootPath,
      config: this.config,
    }).slice(0, 20);
    const context = [
      red.map((binding) => `- 🔴 ${binding.ruleId} ${binding.entity}.${binding.field}`).join('\n'),
      todos
        .map((comment) => `- ${comment.marker} ${comment.file}:${comment.line} ${comment.text}`)
        .join('\n'),
    ]
      .filter(Boolean)
      .join('\n');

    const prompt = [
      'Você é o Arquiteto do VigiaCode. Gere um plano de execução em passos ordenados.',
      `Objetivo: ${objective}`,
      context ? `Problemas conhecidos:\n${context}` : 'Não há pendências detectadas.',
      'Responda SOMENTE com um array JSON: [{"title","description","files":[],"criteria":[],"priority":"p0|p1|p2|p3"}].',
      'Máximo de 8 passos. Critérios devem ser verificáveis.',
    ].join('\n\n');

    try {
      const answer = await provider.complete(prompt, {
        system: 'Responda em português do Brasil, apenas o JSON pedido.',
        temperature: 0.2,
      });
      const parsed = parsePlanJson(answer);
      if (parsed.length > 0) return parsed;
      this.logger?.warn('Plano de IA sem JSON válido; usando plano heurístico.');
    } catch (error) {
      this.logger?.warn(
        `Plano de IA falhou (${error instanceof Error ? error.message : String(error)}); usando heurístico.`,
      );
    }
    return this.heuristicSteps(objective);
  }
}

export interface PlanStep {
  title: string;
  description: string;
  files: string[];
  criteria: string[];
  priority: 'p0' | 'p1' | 'p2' | 'p3';
}

function parsePlanJson(answer: string): PlanStep[] {
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(answer.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const steps: PlanStep[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.title !== 'string') continue;
      steps.push({
        title: record.title.slice(0, 160),
        description: typeof record.description === 'string' ? record.description : '',
        files: asStringArray(record.files),
        criteria: asStringArray(record.criteria),
        priority: isPriority(record.priority) ? record.priority : 'p2',
      });
    }
    return steps;
  } catch {
    return [];
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, 10)
    : [];
}

function isPriority(value: unknown): value is PlanStep['priority'] {
  return value === 'p0' || value === 'p1' || value === 'p2' || value === 'p3';
}

function checklistEntry(label: string, done: boolean) {
  return { label, done, evidence: null };
}

function recordUpsert(
  result: RoadmapGenerationResult,
  kind: RoadmapKind,
  upsert: { created: boolean; reopened: boolean },
): void {
  if (upsert.created) {
    result.created += 1;
    result.byKind[kind].created += 1;
  }
  if (upsert.reopened) {
    result.reopened += 1;
    result.byKind[kind].reopened += 1;
  }
}

function recordClosed(result: RoadmapGenerationResult, kind: RoadmapKind, count: number): void {
  result.closed += count;
  result.byKind[kind].closed += count;
}

function uniqueRefs(bindings: Binding[]): string[] {
  const refs = new Set<string>();
  for (const binding of bindings) {
    if (binding.frontRef) refs.add(binding.frontRef);
    if (binding.backRef) refs.add(binding.backRef);
    if (binding.dbRef) refs.add(binding.dbRef);
  }
  return [...refs];
}

function moduleFromRefs(bindings: Binding[]): string | null {
  for (const binding of bindings) {
    const ref = binding.frontRef ?? binding.backRef ?? binding.dbRef;
    if (ref) return moduleOfPath(stripLine(ref));
  }
  return null;
}

function stripLine(ref: string): string {
  return ref.replace(/:\d+$/, '');
}

function isCodeFile(file: string): boolean {
  return isSupportedBindingFile(file);
}

function hasCorrespondingTest(
  file: string,
  files: ReadonlySet<string>,
  projectRoot: string,
): boolean {
  const base = baseNameOf(file).replace(/\.[^.]+$/, '');
  const extension = extensionOf(file);
  const directory = dirOf(file);
  const candidates = [
    `${directory}/${base}.test${extension}`,
    `${directory}/${base}.spec${extension}`,
    `${directory}/__tests__/${base}.test${extension}`,
    `${directory}/__tests__/${base}.spec${extension}`,
    `${directory}/test_${base}.py`,
    `${directory}/${base}_test.py`,
  ];
  if (candidates.some((candidate) => files.has(candidate))) return true;

  if (extension === '.java' || extension === '.kt') {
    const suffix = [
      `/${base}Test${extension}`,
      `/${base}Tests${extension}`,
      `/${base}IT${extension}`,
    ];
    for (const known of files) {
      if (suffix.some((item) => known.endsWith(item))) return true;
    }
    const testRoot = path.resolve(projectRoot, 'src/test');
    if (existsSync(testRoot) && files.size > 0) {
      for (const item of files) {
        if (!item.includes('/src/test/')) continue;
        if (suffix.some((suffixItem) => item.endsWith(suffixItem))) return true;
      }
    }
  }
  return false;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

/** Agrupa os comentários de dívida por módulo (1 item de roadmap por módulo). */
export function groupTodosByModule(comments: readonly TodoComment[]): Map<string, TodoComment[]> {
  const groups = new Map<string, TodoComment[]>();
  for (const comment of comments) {
    const module = moduleOfPath(comment.file);
    const bucket = groups.get(module) ?? [];
    bucket.push(comment);
    groups.set(module, bucket);
  }
  for (const bucket of groups.values()) {
    bucket.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  }
  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

interface MarkerCounts {
  todo: number;
  fixme: number;
  hack: number;
  urgent: number;
}

function countMarkers(comments: readonly TodoComment[]): MarkerCounts {
  const counts: MarkerCounts = { todo: 0, fixme: 0, hack: 0, urgent: 0 };
  for (const comment of comments) {
    if (comment.marker === 'FIXME') counts.fixme += 1;
    else if (comment.marker === 'HACK') counts.hack += 1;
    else counts.todo += 1;
  }
  counts.urgent = counts.fixme + counts.hack;
  return counts;
}

function markerSummary(counts: MarkerCounts): string {
  const parts: string[] = [];
  if (counts.todo > 0) parts.push(`${counts.todo} TODO`);
  if (counts.fixme > 0) parts.push(`${counts.fixme} FIXME`);
  if (counts.hack > 0) parts.push(`${counts.hack} HACK`);
  return parts.join(' + ');
}

const TODO_EVIDENCE_PATTERN = /^(TODO|FIXME|HACK)\s+(.+):(\d+)\s+—\s*(.*)$/;

/** Reconstrói um comentário a partir da evidência legível salva no item. */
export function parseTodoEvidence(evidence: string): TodoComment | null {
  const match = TODO_EVIDENCE_PATTERN.exec(evidence);
  if (!match) return null;
  const line = Number.parseInt(match[3] ?? '', 10);
  if (!Number.isFinite(line)) return null;
  return {
    marker: (match[1] ?? 'TODO') as TodoComment['marker'],
    file: match[2] ?? '',
    line,
    text: match[4] ?? '',
  };
}

/** Itens p0/p1 ainda abertos (usado na home, status e MCP). Débitos p3 não entram. */
export function listNextSteps(
  db: VigiaCodeDatabase,
  projectId: string,
  limit = 5,
): RoadmapItemView[] {
  return listRoadmapItems(db, projectId, { limit: 200 })
    .filter(
      (item) => item.status === 'todo' || item.status === 'doing' || item.status === 'blocked',
    )
    .filter((item) => item.priority === 'p0' || item.priority === 'p1')
    .sort((left, right) => left.priority.localeCompare(right.priority))
    .slice(0, limit);
}
