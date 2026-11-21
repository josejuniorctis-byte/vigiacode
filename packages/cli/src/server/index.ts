import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AiStatusSnapshot, AiStatusTracker } from '../ai/status.js';
import type { CodeAnchorDatabase } from '../db/client.js';
import {
  CHANGE_EVENT_LAYERS,
  clampLimit,
  findChangeEventById,
  findProjectByRootPath,
  listChangeEvents,
  resolveEventCursor,
  type ChangeEventLayer,
} from '../db/index.js';
import type { Project } from '../db/schema.js';
import { EventHub, toPublicEvent } from './hub.js';

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
    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      createdAt: project.createdAt,
    };
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

    const events = listChangeEvents(options.db, project.id, { limit, before, layer });
    return { events: events.map(toPublicEvent) };
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
