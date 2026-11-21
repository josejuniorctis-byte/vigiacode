import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  findProjectByRootPath,
  insertChangeEvents,
  openDatabase,
  registerProject,
  type OpenedDatabase,
} from '../db/index.js';
import type { Project } from '../db/schema.js';
import { EventHub, type PublicChangeEvent } from './hub.js';
import { createServer } from './index.js';

describe('API local', () => {
  let opened: OpenedDatabase;
  let app: FastifyInstance;
  let project: Project;

  beforeEach(async () => {
    opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    project = registerProject(opened.db, {
      name: 'projeto-teste',
      rootPath: path.resolve('/tmp/projeto-teste'),
    });
    app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
    });
  });

  afterEach(async () => {
    await app.close();
    opened.close();
  });

  it('GET /api/health responde ok com a versão', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });

  it('GET /api/project devolve os dados do projeto', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/project' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: project.id,
      name: 'projeto-teste',
      rootPath: project.rootPath,
    });
    expect(Date.parse((response.json() as { createdAt: string }).createdAt)).not.toBeNaN();
  });

  it('GET /api/events devolve lista vazia nesta etapa', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/events' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ events: [] });
  });

  it('rotas /api desconhecidas devolvem 404 em JSON', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/inexistente' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Rota não encontrada.' });
  });

  it('raiz devolve a página de fallback quando o build do front-end não existe', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('CodeAnchor rodando');
  });
});

describe('build estático do front-end', () => {
  let webDist: string;

  beforeEach(() => {
    webDist = mkdtempSync(path.join(tmpdir(), 'codeanchor-web-'));
    writeFileSync(
      path.join(webDist, 'index.html'),
      '<!doctype html><html><body><h1>CodeAnchor build</h1></body></html>',
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(webDist, { recursive: true, force: true });
  });

  it('serve o index.html do packages/web/dist na raiz', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'projeto-web',
      rootPath: path.resolve('/tmp/projeto-web'),
    });

    const app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: webDist,
    });

    try {
      const root = await app.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('CodeAnchor build');

      const spaRoute = await app.inject({ method: 'GET', url: '/projeto/123' });
      expect(spaRoute.statusCode).toBe(200);
      expect(spaRoute.body).toContain('CodeAnchor build');
    } finally {
      await app.close();
      opened.close();
    }
  });

  it('mantém as rotas da API funcionando junto do estático', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'projeto-web',
      rootPath: path.resolve('/tmp/projeto-web'),
    });

    const app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: webDist,
    });

    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok', version: '1.2.3' });

      expect(findProjectByRootPath(opened.db, project.rootPath)?.id).toBe(project.id);
    } finally {
      await app.close();
      opened.close();
    }
  });
});

describe('eventos: paginação, filtro e detalhe', () => {
  let opened: OpenedDatabase;
  let app: FastifyInstance;
  let project: Project;

  beforeEach(async () => {
    opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    project = registerProject(opened.db, {
      name: 'projeto-eventos',
      rootPath: path.resolve('/tmp/projeto-eventos'),
    });
    app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
    });
  });

  afterEach(async () => {
    await app.close();
    opened.close();
  });

  it('pagina com limit e filtro por layer, sem diff na listagem', async () => {
    insertChangeEvents(opened.db, [
      {
        projectId: project.id,
        filePath: 'src/api/a.ts',
        changeType: 'change',
        diff: '+a',
        layer: 'backend',
        summary: 'resumo a',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      {
        projectId: project.id,
        filePath: 'src/components/b.tsx',
        changeType: 'add',
        diff: '+b',
        layer: 'frontend',
        summary: null,
        createdAt: '2026-01-01T00:00:02.000Z',
      },
      {
        projectId: project.id,
        filePath: 'db/schema.sql',
        changeType: 'change',
        diff: '+c',
        layer: 'database',
        summary: 'resumo c',
        createdAt: '2026-01-01T00:00:03.000Z',
      },
    ]);

    const latest = await app.inject({ method: 'GET', url: '/api/events?limit=1' });
    expect(latest.statusCode).toBe(200);
    const latestBody = latest.json() as { events: PublicChangeEvent[] };
    expect(latestBody.events).toHaveLength(1);
    expect(latestBody.events[0]?.filePath).toBe('db/schema.sql');
    expect(latestBody.events[0]).not.toHaveProperty('diff');

    const backend = await app.inject({ method: 'GET', url: '/api/events?layer=backend' });
    const backendBody = backend.json() as { events: PublicChangeEvent[] };
    expect(backendBody.events).toHaveLength(1);
    expect(backendBody.events[0]?.layer).toBe('backend');

    const cursor = latestBody.events[0]!.id;
    const older = await app.inject({
      method: 'GET',
      url: `/api/events?before=${cursor}&limit=1`,
    });
    const olderBody = older.json() as { events: PublicChangeEvent[] };
    expect(olderBody.events).toHaveLength(1);
    expect(olderBody.events[0]?.filePath).toBe('src/components/b.tsx');

    const invalidLayer = await app.inject({ method: 'GET', url: '/api/events?layer=nope' });
    expect(invalidLayer.statusCode).toBe(400);

    const invalidLimit = await app.inject({ method: 'GET', url: '/api/events?limit=0' });
    expect(invalidLimit.statusCode).toBe(400);
  });

  it('devolve o diff completo em /api/events/:id', async () => {
    const [event] = insertChangeEvents(opened.db, [
      {
        projectId: project.id,
        filePath: 'src/api/a.ts',
        changeType: 'change',
        diff: '+const x = 1;',
        layer: 'backend',
        summary: 'resumo',
      },
    ]);

    const response = await app.inject({ method: 'GET', url: `/api/events/${event!.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: event!.id,
      filePath: 'src/api/a.ts',
      diff: '+const x = 1;',
      diffTruncated: false,
      summary: 'resumo',
    });

    const missing = await app.inject({ method: 'GET', url: '/api/events/nao-existe' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('GET /api/events/stream (SSE)', () => {
  it('emite eventos novos e resumos concluídos', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'projeto-sse',
      rootPath: path.resolve('/tmp/projeto-sse'),
    });
    const hub = new EventHub();
    const streamApp = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
      hub,
    });

    const controller = new AbortController();

    try {
      await streamApp.listen({ port: 0, host: '127.0.0.1' });
      const address = streamApp.server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;

      const response = await fetch(`http://127.0.0.1:${port}/api/events/stream`, {
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const sse = createSseReader(reader!);
      await sse.waitFor('conectado');

      const event: PublicChangeEvent = {
        id: 'evento-1',
        projectId: project.id,
        filePath: 'src/api/a.ts',
        changeType: 'change',
        layer: 'backend',
        batchId: 'lote-1',
        summary: null,
        createdAt: new Date().toISOString(),
      };
      hub.publish({ type: 'change', event });

      await sse.waitFor('event: change');
      expect(sse.buffer).toContain('src/api/a.ts');

      hub.publish({ type: 'summary', event: { ...event, summary: 'Resumo pronto.' } });
      await sse.waitFor('event: summary');
      expect(sse.buffer).toContain('Resumo pronto.');
    } finally {
      controller.abort();
      await streamApp.close();
      opened.close();
    }
  });
});

interface SseReader {
  readonly buffer: string;
  waitFor(needle: string, timeoutMs?: number): Promise<string>;
}

function createSseReader(reader: ReadableStreamDefaultReader<Uint8Array>): SseReader {
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    get buffer() {
      return buffer;
    },
    async waitFor(needle: string, timeoutMs = 3000): Promise<string> {
      const deadline = Date.now() + timeoutMs;

      while (!buffer.includes(needle)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timeout aguardando "${needle}" no SSE`);

        const result = await readWithTimeout(reader, remaining);
        if (result.done) throw new Error('stream SSE encerrado');
        buffer += decoder.decode(result.value, { stream: true });
      }

      return buffer;
    },
  };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof reader.read>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout aguardando evento no SSE')), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
