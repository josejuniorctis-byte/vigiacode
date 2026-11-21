import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { createProvider, describeProviderError, sanitizeSummary } from '../ai/index.js';
import type { AiStatusSnapshot, AiStatusTracker } from '../ai/status.js';
import type { BindingExplanation, BindingMatrix, BindingsScanner } from '../bindings/index.js';
import { explainHeuristic } from '../bindings/explain.js';
import {
  effectiveModel,
  isBindingRuleId,
  providerDefaults,
  type CodeAnchorConfig,
} from '../config.js';
import type { CodeAnchorDatabase } from '../db/client.js';
import {
  CHANGE_EVENT_LAYERS,
  acceptBinding,
  clampBindingLimit,
  clampLimit,
  findBindingById,
  findChangeEventById,
  findProjectByRootPath,
  getLatestBindingScan,
  getLatestSnapshot,
  getProjectStats,
  listBindingScans,
  listBindings,
  listChangeEvents,
  listFileEvents,
  listSnapshots,
  resolveEventCursor,
  summarizeBindings,
  type ChangeEventLayer,
} from '../db/index.js';
import type { Binding, BindingLayer, BindingStatus, Project } from '../db/schema.js';
import { EventHub, toPublicEvent } from './hub.js';

export interface GitInfo {
  branch: string | null;
  commitHash: string | null;
}

export interface CreateServerOptions {
  db: CodeAnchorDatabase;
  project: Project;
  version: string;
  /** Caminho do build de packages/web/dist (ou null quando ainda não existe). */
  webDistPath?: string | null;
  /** Ativa os logs internos do Fastify (pino). Por padrão fica desligado. */
  logger?: boolean;
  /** Hub do SSE; se omitido, o servidor cria um hub vazio. */
  hub?: EventHub;
  /** Status da IA para GET /api/ai/status. */
  aiStatus?: AiStatusTracker;
  /** Configuração ativa (para GET /api/config e POST /api/ai/test). */
  config?: CodeAnchorConfig;
  /** Branch/commit atuais para o cabeçalho do dashboard. */
  gitInfo?: GitInfo;
  /** Detector de amarrações (Etapa 4). Sem ele as rotas de leitura ainda funcionam. */
  bindingsScanner?: BindingsScanner | null;
  /** Explica uma amarração; quando omitido, usa a explicação heurística. */
  explainBinding?: ((binding: Binding) => Promise<BindingExplanation>) | null;
}

const DEFAULT_AI_STATUS: AiStatusSnapshot = {
  provider: 'none',
  model: null,
  keyPresent: true,
  lastHealthCheck: null,
};

/** Raiz do pacote codeanchor (funciona a partir de src/ e de dist/). */
export function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../..');
}

/** Procura o build do front-end sem depender do cwd do usuário. */
export function resolveWebDistPath(): string | null {
  const candidates = [
    process.env.CODEANCHOR_WEB_DIST,
    path.resolve(packageRoot(), '../web/dist'),
    path.resolve(packageRoot(), 'web'),
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

function fallbackPage(projectName: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CodeAnchor</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #070b12; color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      main { max-width: 34rem; padding: 2.5rem; }
      .mark { font-size: 2.5rem; }
      h1 { font-size: 1.5rem; margin: 0.75rem 0 0.5rem; }
      p { color: #94a3b8; line-height: 1.6; margin: 0.35rem 0; }
      code {
        background: #111a28; border: 1px solid #1e293b; border-radius: 0.375rem;
        padding: 0.15rem 0.4rem; color: #7dd3fc;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">⚓</div>
      <h1>CodeAnchor rodando</h1>
      <p>Projeto <strong>${escapeHtml(projectName)}</strong> — API local ativa.</p>
      <p>A interface web ainda não foi buildada. Na raiz do monorepo, rode <code>pnpm build</code> e reinicie o servidor.</p>
      <p>Health check: <code>/api/health</code></p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Cria a instância do Fastify com as rotas da API local.
 * Não escuta porta: isso é responsabilidade de `start` (commands/start.ts).
 */
export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  const hub = options.hub ?? new EventHub();
  const webDist = options.webDistPath ?? null;
  const hasWebBuild = webDist !== null && existsSync(path.join(webDist, 'index.html'));

  const requireProject = () => findProjectByRootPath(options.db, options.project.rootPath);

  app.get('/api/health', async () => ({
    status: 'ok',
    version: options.version,
  }));

  app.get('/api/ai/status', async () => {
    return options.aiStatus?.snapshot() ?? { ...DEFAULT_AI_STATUS };
  });

  app.get('/api/project', async (_request, reply) => {
    const project = requireProject();
    if (!project) {
      return reply.code(404).send({
        error: 'Projeto não encontrado no banco local. Rode "codeanchor init" novamente.',
      });
    }
    const latestSnapshot = getLatestSnapshot(options.db, project.id);
    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      createdAt: project.createdAt,
      branch: options.gitInfo?.branch ?? null,
      commitHash: latestSnapshot?.commitHash ?? options.gitInfo?.commitHash ?? null,
    };
  });

  app.get('/api/config', async (_request, reply) => {
    if (!options.config) {
      return reply.code(404).send({ error: 'Configuração indisponível neste servidor.' });
    }
    return publicConfig(options.config);
  });

  app.post('/api/ai/test', async (_request, reply) => {
    if (!options.config) {
      return reply.code(404).send({ error: 'Configuração indisponível neste servidor.' });
    }

    const llm = options.config.llm;
    const providerName = llm.provider;
    const model = effectiveModel(llm);

    if (providerName === 'none') {
      return {
        ok: true,
        provider: providerName,
        model,
        elapsedMs: 0,
        response: 'Provider "none": o CodeAnchor usa resumo heurístico local.',
      };
    }

    let provider;
    try {
      provider = createProvider(llm);
    } catch (error) {
      return {
        ok: false,
        provider: providerName,
        model,
        elapsedMs: 0,
        error: describeProviderError(error, providerName, {
          baseUrl: llm.baseUrl ?? providerDefaults(providerName).baseUrl,
        }),
      };
    }

    const started = Date.now();
    try {
      const answer = await provider.complete(
        'Responda em uma frase curta, em português: qual é o objetivo do CodeAnchor?',
        { system: 'Você é um assistente técnico objetivo. Responda em português do Brasil.' },
      );
      return {
        ok: true,
        provider: providerName,
        model: model ?? providerDefaults(providerName).model,
        elapsedMs: Date.now() - started,
        response: sanitizeSummary(answer, 400),
      };
    } catch (error) {
      return {
        ok: false,
        provider: providerName,
        model,
        elapsedMs: Date.now() - started,
        error: describeProviderError(error, providerName, {
          baseUrl: llm.baseUrl ?? providerDefaults(providerName).baseUrl,
        }),
      };
    }
  });

  app.get('/api/events/stream', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n');
    reply.raw.write(': conectado ao CodeAnchor\n\n');

    const unsubscribe = hub.subscribe((message) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, 15_000);
    heartbeat.unref?.();

    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
    };

    request.raw.on('close', close);
    request.raw.on('error', close);
  });

  app.get('/api/events/:id', async (request, reply) => {
    const project = requireProject();
    if (!project) {
      return reply.code(404).send({
        error: 'Projeto não encontrado no banco local. Rode "codeanchor init" novamente.',
      });
    }

    const { id } = request.params as { id: string };
    const event = findChangeEventById(options.db, id);
    if (!event || event.projectId !== project.id) {
      return reply.code(404).send({ error: 'Evento não encontrado.' });
    }

    return {
      ...toPublicEvent(event),
      diff: event.diff,
      diffTruncated: event.diffTruncated,
    };
  });

  app.get('/api/events', async (request, reply) => {
    const project = requireProject();
    if (!project) {
      return reply.code(404).send({
        error: 'Projeto não encontrado no banco local. Rode "codeanchor init" novamente.',
      });
    }

    const query = request.query as Record<string, unknown>;

    const limit = parseLimit(query.limit);
    if (limit === null) {
      return reply.code(400).send({ error: 'Parâmetro "limit" inválido (use 1 a 200).' });
    }

    const layer = parseLayer(query.layer);
    if (layer === null) {
      return reply.code(400).send({
        error: `Parâmetro "layer" inválido. Use: ${CHANGE_EVENT_LAYERS.join(', ')}.`,
      });
    }

    const before = query.before;
    if (before !== undefined && typeof before !== 'string') {
      return reply.code(400).send({ error: 'Parâmetro "before" inválido.' });
    }
    if (before && resolveEventCursor(options.db, project.id, before) === null) {
      return reply.code(400).send({
        error: 'Cursor "before" inválido: use o id de um evento ou um timestamp ISO.',
      });
    }

    const search = parseSearch(query.q);
    if (search === null) {
      return reply.code(400).send({ error: 'Parâmetro "q" inválido.' });
    }

    const from = parseIsoDate(query.from);
    const to = parseIsoDate(query.to);
    if (from === null || to === null) {
      return reply.code(400).send({ error: 'Parâmetros "from"/"to" devem ser datas ISO válidas.' });
    }

    const events = listChangeEvents(options.db, project.id, {
      limit,
      before,
      layer,
      search: search ?? undefined,
      from,
      to,
    });
    return { events: events.map(toPublicEvent) };
  });

  app.get('/api/snapshots', async (_request, reply) => {
    const project = requireProject();
    if (!project) {
      return reply.code(404).send({
        error: 'Projeto não encontrado no banco local. Rode "codeanchor init" novamente.',
      });
    }
    return { snapshots: listSnapshots(options.db, project.id) };
  });

  app.get('/api/stats', async (_request, reply) => {
    const project = requireProject();
    if (!project) {
      return reply.code(404).send({
        error: 'Projeto não encontrado no banco local. Rode "codeanchor init" novamente.',
      });
    }
    return getProjectStats(options.db, project.id);
  });

  // ---------------------------------------------------------------------------
  // Detector de amarrações (Etapa 4)
  // ---------------------------------------------------------------------------

  app.get('/api/bindings', async (request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);

    const query = request.query as Record<string, unknown>;
    const status = parseBindingStatus(query.status);
    if (status === null) {
      return reply.code(400).send({ error: 'Parâmetro "status" inválido (red, yellow ou green).' });
    }
    const layer = parseBindingLayer(query.layer);
    if (layer === null) {
      return reply
        .code(400)
        .send({ error: 'Parâmetro "layer" inválido (frontend, backend ou database).' });
    }
    const rule = parseBindingRule(query.rule);
    if (rule === null) return reply.code(400).send({ error: 'Parâmetro "rule" inválido.' });
    const entity = parseOptionalText(query.entity);
    if (entity === null) return reply.code(400).send({ error: 'Parâmetro "entity" inválido.' });
    const search = parseSearch(query.q);
    if (search === null) return reply.code(400).send({ error: 'Parâmetro "q" inválido.' });
    const limit = parseBindingLimit(query.limit);
    if (limit === null) {
      return reply.code(400).send({ error: 'Parâmetro "limit" inválido (use 1 a 1000).' });
    }

    const bindings = listBindings(options.db, project.id, {
      status,
      layer,
      rule,
      entity: entity ?? undefined,
      search: search ?? undefined,
      includeResolved: parseBoolean(query.includeResolved ?? query.resolved),
      includeAccepted: parseBoolean(query.includeAccepted ?? query.accepted),
      limit,
    });

    return { bindings: bindings.map(toPublicBinding) };
  });

  app.get('/api/bindings/summary', async (_request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);
    return summarizeBindings(options.db, project.id);
  });

  app.get('/api/bindings/matrix', async (_request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);

    const fromScanner = options.bindingsScanner?.matrix() ?? null;
    if (fromScanner) return fromScanner;

    const latest = getLatestBindingScan(options.db, project.id);
    if (latest?.matrixJson) {
      try {
        return JSON.parse(latest.matrixJson) as BindingMatrix;
      } catch {
        // Cai na matriz vazia abaixo.
      }
    }

    return emptyMatrix();
  });

  app.get('/api/bindings/scans', async (request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);

    const query = request.query as Record<string, unknown>;
    const limit = parseBindingLimit(query.limit);
    if (limit === null) {
      return reply.code(400).send({ error: 'Parâmetro "limit" inválido (use 1 a 1000).' });
    }
    return { scans: listBindingScans(options.db, project.id, limit) };
  });

  app.get('/api/bindings/:id', async (request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);

    const { id } = request.params as { id: string };
    const binding = findBindingById(options.db, id);
    if (!binding || binding.projectId !== project.id) {
      return reply.code(404).send({ error: 'Amarração não encontrada.' });
    }
    return toPublicBinding(binding);
  });

  app.post('/api/bindings/scan', async (_request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);
    if (!options.bindingsScanner) {
      return reply.code(503).send({ error: 'Detector de amarrações indisponível neste servidor.' });
    }

    const result = await options.bindingsScanner.scan({ trigger: 'manual' });
    if (!result) return { skipped: true };
    return result;
  });

  app.post('/api/bindings/:id/accept', async (request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);

    const { id } = request.params as { id: string };
    const binding = findBindingById(options.db, id);
    if (!binding || binding.projectId !== project.id) {
      return reply.code(404).send({ error: 'Amarração não encontrada.' });
    }

    const updated = acceptBinding(options.db, id);
    return updated
      ? toPublicBinding(updated)
      : reply.code(404).send({ error: 'Amarração não encontrada.' });
  });

  app.post('/api/bindings/:id/explain', async (request, reply) => {
    const project = requireProject();
    if (!project) return projectNotFound(reply);

    const { id } = request.params as { id: string };
    const binding = findBindingById(options.db, id);
    if (!binding || binding.projectId !== project.id) {
      return reply.code(404).send({ error: 'Amarração não encontrada.' });
    }

    if (options.explainBinding) {
      try {
        return await options.explainBinding(binding);
      } catch {
        // Falha de IA não impede a explicação heurística.
      }
    }

    const heuristic = explainHeuristic(binding);
    return {
      bindingId: binding.id,
      provider: 'none',
      model: null,
      heuristic: true,
      explanation: heuristic.explanation,
      suggestion: heuristic.suggestion,
    } satisfies BindingExplanation;
  });

  app.get('/api/files/events', async (request, reply) => {
    const project = requireProject();
    if (!project) {
      return reply.code(404).send({
        error: 'Projeto não encontrado no banco local. Rode "codeanchor init" novamente.',
      });
    }

    const query = request.query as Record<string, unknown>;
    const filePath = typeof query.path === 'string' ? query.path.trim() : '';
    if (filePath.length === 0) {
      return reply.code(400).send({ error: 'Parâmetro "path" é obrigatório.' });
    }

    const limit = parseLimit(query.limit);
    if (limit === null) {
      return reply.code(400).send({ error: 'Parâmetro "limit" inválido (use 1 a 200).' });
    }

    const before = query.before;
    if (before !== undefined && typeof before !== 'string') {
      return reply.code(400).send({ error: 'Parâmetro "before" inválido.' });
    }
    if (before && resolveEventCursor(options.db, project.id, before) === null) {
      return reply.code(400).send({ error: 'Cursor "before" inválido.' });
    }

    const events = listFileEvents(options.db, project.id, filePath, { limit, before });
    return { filePath, events: events.map(toPublicEvent) };
  });

  if (hasWebBuild && webDist !== null) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: true,
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Rota não encontrada.' });
    }

    if (request.method === 'GET' && hasWebBuild) {
      // Fallback de SPA: qualquer rota do front-end devolve o index.html.
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }

    if (request.method === 'GET') {
      return reply
        .type('text/html; charset=utf-8')
        .code(200)
        .send(fallbackPage(options.project.name));
    }

    return reply.code(404).send({ error: 'Rota não encontrada.' });
  });

  return app;
}

function projectNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: 'Projeto não encontrado no banco local. Rode "codeanchor init" novamente.',
  });
}

function parseBindingStatus(value: unknown): BindingStatus | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value === 'red' || value === 'yellow' || value === 'green' ? value : null;
}

function parseBindingLayer(value: unknown): BindingLayer | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value === 'frontend' || value === 'backend' || value === 'database' ? value : null;
}

function parseBindingRule(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  if (value === 'GREEN' || isBindingRuleId(value)) return value;
  return null;
}

function parseOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === '1' || value === 'true' || value === 'yes';
}

function parseBindingLimit(value: unknown): number | null {
  if (value === undefined) return clampBindingLimit(undefined);
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) return null;
  return parsed;
}

function toPublicBinding(binding: Binding): Binding {
  return {
    ...binding,
    message: binding.message ?? '',
  };
}

function emptyMatrix(): BindingMatrix {
  return {
    generatedAt: new Date().toISOString(),
    scanId: null,
    entities: [],
    totals: { entities: 0, integrated: 0, partial: 0, local: 0, missing: 0 },
  };
}

function parseLimit(value: unknown): number | null {
  if (value === undefined) return clampLimit(undefined);
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) return null;
  return parsed;
}

/** undefined = parâmetro ausente; null = inválido. */
function parseLayer(value: unknown): ChangeEventLayer | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return (CHANGE_EVENT_LAYERS as readonly string[]).includes(value)
    ? (value as ChangeEventLayer)
    : null;
}

/** undefined = ausente; null = inválido; texto normalizado quando válido. */
function parseSearch(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** undefined = ausente; null = inválida; ISO normalizada quando válida. */
function parseIsoDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function publicConfig(config: CodeAnchorConfig): Record<string, unknown> {
  return {
    project: { name: config.project.name, rootPath: config.project.rootPath },
    watch: config.watch,
    git: config.git,
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      baseUrl: config.llm.baseUrl,
      timeoutMs: config.llm.timeoutMs,
      maxTokens: config.llm.maxTokens ?? null,
      temperature: config.llm.temperature ?? null,
      fallbackProviders: config.llm.fallbackProviders ?? [],
    },
    bindings: config.bindings,
    server: config.server,
    database: config.database,
  };
}
