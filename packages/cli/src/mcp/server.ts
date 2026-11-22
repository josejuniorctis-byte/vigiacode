import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Architect } from '../architect/index.js';
import type { BindingsScanner } from '../bindings/index.js';
import { moduleOfPath } from '../architect/module.js';
import { normalizeEntityName } from '../bindings/names.js';
import type { VigiaCodeConfig } from '../config.js';
import {
  countRoadmapItems,
  findRoadmapItem,
  getLatestBindingScan,
  listBindings,
  listChangeEvents,
  listRoadmapItems,
  summarizeBindings,
  updateRoadmapItem,
  type OpenedDatabase,
} from '../db/index.js';
import type {
  Project,
  RoadmapChecklistEntry,
  RoadmapKind,
  RoadmapPriority,
  RoadmapStatus,
} from '../db/schema.js';

/**
 * Servidor MCP do VigiaCode (stdio).
 *
 * Segurança: lê apenas o projeto local e o banco do VigiaCode. A única escrita
 * é `vigiacode_roadmap_update`, restrita ao próprio banco local. Nenhuma chave
 * ou conteúdo de `.env` é lido/exibido.
 */

export interface McpContext {
  opened: OpenedDatabase;
  project: Project;
  config: VigiaCodeConfig;
  scanner: BindingsScanner;
  architect: Architect;
  version: string;
}

const STATUS = z.enum(['red', 'yellow', 'green']);
const ROADMAP_STATUS = z.enum(['todo', 'doing', 'done', 'blocked']);
const ROADMAP_KIND = z.enum(['feature', 'fix', 'debt', 'binding', 'test', 'doc']);
const ROADMAP_PRIORITY = z.enum(['p0', 'p1', 'p2', 'p3']);

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function stripLine(ref: string | null): string | null {
  return ref ? ref.replace(/:\d+$/, '') : null;
}

function moduleOfBinding(refs: Array<string | null>): string | null {
  for (const ref of refs) {
    const file = stripLine(ref);
    if (file) return moduleOfPath(file);
  }
  return null;
}

function publicBinding(binding: ReturnType<typeof listBindings>[number]) {
  return {
    id: binding.id,
    ruleId: binding.ruleId,
    layer: binding.layer,
    entity: binding.entity,
    field: binding.field || '*',
    status: binding.status,
    message: binding.message,
    refs: {
      front: binding.frontRef,
      back: binding.backRef,
      db: binding.dbRef,
    },
    module: moduleOfBinding([binding.frontRef, binding.backRef, binding.dbRef]),
    suggestion: binding.suggestion,
    lastSeenAt: binding.lastSeenAt,
    resolvedAt: binding.resolvedAt,
    accepted: binding.accepted,
  };
}

function projectStatus(context: McpContext) {
  const summary = summarizeBindings(context.opened.db, context.project.id);
  const roadmap = countRoadmapItems(context.opened.db, context.project.id);
  return {
    project: {
      id: context.project.id,
      name: context.project.name,
      rootPath: context.project.rootPath,
    },
    bindings: {
      red: summary.red,
      yellow: summary.yellow,
      green: summary.green,
      healthPercent: summary.healthPercent,
      weightedHealthPercent: summary.weightedHealthPercent,
      fieldHealthPercent: summary.fieldHealthPercent,
      profile: summary.profile,
      coverage: summary.coverage,
    },
    roadmap,
    lastScan: summary.lastScan
      ? {
          id: summary.lastScan.id,
          startedAt: summary.lastScan.startedAt,
          finishedAt: summary.lastScan.finishedAt,
          filesScanned: summary.lastScan.filesScanned,
          trigger: summary.lastScan.trigger,
          error: summary.lastScan.error,
        }
      : null,
    // Nunca inclui chaves; apenas o provider/modelo configurados.
    ai: { provider: context.config.llm.provider, model: context.config.llm.model },
  };
}

function latestMatrix(context: McpContext): unknown {
  const scan = getLatestBindingScan(context.opened.db, context.project.id);
  if (!scan?.matrixJson) return { generatedAt: null, scanId: null, entities: [], totals: null };
  try {
    return JSON.parse(scan.matrixJson) as unknown;
  } catch {
    return {
      generatedAt: null,
      scanId: scan.id,
      entities: [],
      totals: null,
      error: 'matriz corrompida',
    };
  }
}

export function createMcpServer(context: McpContext): McpServer {
  const server = new McpServer({ name: 'vigiacode', version: context.version });

  server.registerTool(
    'vigiacode_status',
    {
      title: 'Status do VigiaCode',
      description:
        'Resumo do projeto: contagens de amarrações (🔴/🟡/🟢), saúde simples e ponderada, cobertura por regra, perfil ativo e contagens do roadmap.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(projectStatus(context)),
  );

  server.registerTool(
    'vigiacode_bindings',
    {
      title: 'Listar amarrações',
      description:
        'Lista amarrações com referências arquivo:linha. Filtra por status, entidade, regra (R1..R10/GREEN) e módulo.',
      inputSchema: {
        status: STATUS.optional(),
        entity: z.string().optional(),
        rule: z.string().optional(),
        module: z.string().optional(),
        includeResolved: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let bindings = listBindings(context.opened.db, context.project.id, {
        status: args.status,
        entity: args.entity ? normalizeEntityName(args.entity) : undefined,
        rule: args.rule,
        includeResolved: args.includeResolved ?? false,
        limit: args.limit ?? 100,
      });
      if (args.module) {
        const module = args.module.toLowerCase();
        bindings = bindings.filter(
          (binding) =>
            moduleOfBinding([binding.frontRef, binding.backRef, binding.dbRef])?.toLowerCase() ===
            module,
        );
      }
      return jsonResult({
        count: bindings.length,
        bindings: bindings.map(publicBinding),
      });
    },
  );

  server.registerTool(
    'vigiacode_check_entity',
    {
      title: 'Checar entidade nas camadas',
      description:
        'Verifica uma entidade no front-end, back-end e banco: campos pendentes, referências e o veredito da matriz (integrada, parcial, local, faltando).',
      inputSchema: {
        entity: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const entity = normalizeEntityName(args.entity);
      const bindings = listBindings(context.opened.db, context.project.id, {
        entity,
        limit: 500,
      });
      const matrix = latestMatrix(context) as {
        entities?: Array<{
          entity: string;
          rawName?: string;
          front?: unknown;
          back?: unknown;
          db?: unknown;
          status?: string;
          link?: string;
          pending?: number;
          missing?: string[];
        }>;
      } | null;
      const row = matrix?.entities?.find((item) => item.entity === entity) ?? null;
      return jsonResult({
        entity,
        found: bindings.length > 0 || row !== null,
        matrix: row,
        pending: bindings.filter((binding) => binding.status !== 'green').map(publicBinding),
        green: bindings.filter((binding) => binding.status === 'green').map(publicBinding),
      });
    },
  );

  server.registerTool(
    'vigiacode_roadmap',
    {
      title: 'Consultar roadmap',
      description:
        'Lista os itens do roadmap vivo (Arquiteto) com filtros de status, tipo, prioridade e módulo, além das contagens por status.',
      inputSchema: {
        status: ROADMAP_STATUS.optional(),
        kind: ROADMAP_KIND.optional(),
        priority: ROADMAP_PRIORITY.optional(),
        module: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const items = listRoadmapItems(context.opened.db, context.project.id, {
        status: args.status as RoadmapStatus | undefined,
        kind: args.kind as RoadmapKind | undefined,
        priority: args.priority as RoadmapPriority | undefined,
        module: args.module,
        search: args.search,
        limit: args.limit ?? 200,
      });
      return jsonResult({
        counts: countRoadmapItems(context.opened.db, context.project.id),
        count: items.length,
        items,
      });
    },
  );

  server.registerTool(
    'vigiacode_roadmap_update',
    {
      title: 'Atualizar item do roadmap',
      description:
        'Única ferramenta de escrita: atualiza status/prioridade/checklist/título de um item do roadmap. Escreve somente no banco local do VigiaCode.',
      inputSchema: {
        id: z.string().min(1),
        status: ROADMAP_STATUS.optional(),
        priority: ROADMAP_PRIORITY.optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        note: z.string().optional(),
        checklist: z
          .array(
            z.object({
              label: z.string(),
              done: z.boolean(),
              evidence: z.string().nullable().optional(),
            }),
          )
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const existing = findRoadmapItem(context.opened.db, args.id);
      if (!existing || existing.projectId !== context.project.id) {
        return jsonResult({ updated: false, error: 'Item do roadmap não encontrado.' });
      }
      const description =
        args.note && !args.description
          ? `${existing.description}\n[${new Date().toISOString().slice(0, 16).replace('T', ' ')}] ${args.note}`
          : args.description;
      const updated = updateRoadmapItem(context.opened.db, args.id, {
        status: args.status as RoadmapStatus | undefined,
        priority: args.priority as RoadmapPriority | undefined,
        title: args.title,
        description,
        checklist: args.checklist as RoadmapChecklistEntry[] | undefined,
      });
      return jsonResult({ updated: Boolean(updated), item: updated ?? null });
    },
  );

  server.registerTool(
    'vigiacode_recent_changes',
    {
      title: 'Mudanças recentes',
      description:
        'Eventos recentes capturados pelo vigia (arquivo, camada, resumo, adições/remoções).',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        layer: z.enum(['frontend', 'backend', 'database', 'config', 'other']).optional(),
        sinceMinutes: z
          .number()
          .int()
          .min(1)
          .max(60 * 24 * 30)
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const from =
        args.sinceMinutes === undefined
          ? undefined
          : new Date(Date.now() - args.sinceMinutes * 60_000).toISOString();
      const events = listChangeEvents(context.opened.db, context.project.id, {
        limit: args.limit ?? 20,
        layer: args.layer,
        from,
      });
      return jsonResult({
        count: events.length,
        events: events.map((event) => ({
          id: event.id,
          filePath: event.filePath,
          changeType: event.changeType,
          layer: event.layer,
          batchId: event.batchId,
          summary: event.summary,
          createdAt: event.createdAt,
          diffTruncated: event.diffTruncated,
        })),
      });
    },
  );

  server.registerTool(
    'vigiacode_scan',
    {
      title: 'Escanear amarrações',
      description:
        'Roda o detector de amarrações (incremental quando `changedFiles` é informado, completo caso contrário) e devolve o diff de contagens antes/depois.',
      inputSchema: {
        changedFiles: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const before = summarizeBindings(context.opened.db, context.project.id);
      const result = await context.scanner.scan({
        trigger: 'manual',
        changedFiles: args.changedFiles,
      });
      if (!result) {
        return jsonResult({
          skipped: true,
          reason: 'Nenhum arquivo suportado nas mudanças informadas.',
          before: { red: before.red, yellow: before.yellow, green: before.green },
        });
      }
      const after = result.summary;
      return jsonResult({
        scanId: result.scan.id,
        filesScanned: result.filesScanned,
        incremental: args.changedFiles !== undefined,
        before: { red: before.red, yellow: before.yellow, green: before.green },
        after: { red: after.red, yellow: after.yellow, green: after.green },
        delta: {
          red: after.red - before.red,
          yellow: after.yellow - before.yellow,
          green: after.green - before.green,
        },
        created: result.created.length,
        resolved: result.resolved.length,
      });
    },
  );

  server.registerResource(
    'vigiacode-summary',
    'vigiacode://summary',
    {
      title: 'Resumo do VigiaCode',
      description: 'Status consolidado do projeto (amarrações, saúde, roadmap).',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(projectStatus(context), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'vigiacode-matrix',
    'vigiacode://matrix',
    {
      title: 'Matriz de amarrações',
      description: 'Matriz entidade × front-end × back-end × banco do último scan.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(latestMatrix(context), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'vigiacode-roadmap',
    'vigiacode://roadmap',
    {
      title: 'Roadmap vivo',
      description: 'Itens abertos e contagens do roadmap do Arquiteto.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              counts: countRoadmapItems(context.opened.db, context.project.id),
              items: listRoadmapItems(context.opened.db, context.project.id, { limit: 500 }),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerPrompt(
    'antes-de-codar',
    {
      title: 'Antes de codar',
      description:
        'Checklist obrigatório antes de alterar código: consulta status, amarrações e roadmap do VigiaCode.',
      argsSchema: {
        objetivo: z.string().optional(),
      },
    },
    ({ objetivo }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Antes de alterar código neste projeto, use o servidor MCP do VigiaCode:',
              '1. Chame vigiacode_status para ver saúde, cobertura e pendências.',
              '2. Chame vigiacode_bindings (status=red) e vigiacode_check_entity para as entidades afetadas.',
              '3. Consulte vigiacode_roadmap para respeitar prioridades p0/p1 e itens em andamento.',
              '4. Depois de implementar, rode vigiacode_scan e feche/atualize os itens com vigiacode_roadmap_update.',
              'Nunca leia nem altere .env, chaves ou dados fora do banco local do VigiaCode.',
              objetivo ? `Objetivo da tarefa: ${objetivo}` : 'Objetivo da tarefa: (não informado)',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}

/** Sobe o servidor com o transporte stdio (usado por `vigiacode mcp`). */
export async function startMcpServer(context: McpContext): Promise<McpServer> {
  const server = createMcpServer(context);
  await server.connect(new StdioServerTransport());
  return server;
}
