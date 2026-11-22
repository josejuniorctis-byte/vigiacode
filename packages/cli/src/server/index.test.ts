import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiStatusTracker } from '../ai/status.js';
import { createDefaultConfig } from '../config.js';
import {
  applyMigrations,
  findProjectByRootPath,
  insertChangeEvents,
  insertSnapshot,
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
    expect(response.body).toContain('VigiaCode rodando');
  });
});

describe('build estático do front-end', () => {
  let webDist: string;

  beforeEach(() => {
    webDist = mkdtempSync(path.join(tmpdir(), 'vigiacode-web-'));
    writeFileSync(
      path.join(webDist, 'index.html'),
      '<!doctype html><html><body><h1>VigiaCode build</h1></body></html>',
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
      expect(root.body).toContain('VigiaCode build');

      const spaRoute = await app.inject({ method: 'GET', url: '/projeto/123' });
      expect(spaRoute.statusCode).toBe(200);
      expect(spaRoute.body).toContain('VigiaCode build');
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

describe('GET /api/ai/status', () => {
  it('expõe provider, modelo, presença da chave e último healthCheck sem vazar segredo', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'projeto-ia',
      rootPath: path.resolve('/tmp/projeto-ia'),
    });
    const tracker = new AiStatusTracker(
      'openai',
      {
        name: 'openai',
        complete: async () => 'ok',
        healthCheck: async () => true,
      },
      'gpt-4o-mini',
      true,
    );
    await tracker.refresh();

    const app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
      aiStatus: tracker,
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/status' });
      const body = response.json() as {
        provider: string;
        model: string;
        keyPresent: boolean;
        lastHealthCheck: { ok: boolean; checkedAt: string } | null;
      };

      expect(response.statusCode).toBe(200);
      expect(body.provider).toBe('openai');
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.keyPresent).toBe(true);
      expect(body.lastHealthCheck?.ok).toBe(true);
      expect(Date.parse(body.lastHealthCheck?.checkedAt ?? '')).not.toBeNaN();
      expect(body).not.toHaveProperty('key');
      expect(body).not.toHaveProperty('apiKey');
    } finally {
      await app.close();
      opened.close();
    }
  });

  it('sem tracker devolve o status neutro (none)', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'projeto-ia-padrao',
      rootPath: path.resolve('/tmp/projeto-ia-padrao'),
    });
    const app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/ai/status' });
      expect(response.json()).toMatchObject({
        provider: 'none',
        model: null,
        keyPresent: true,
        lastHealthCheck: null,
      });
    } finally {
      await app.close();
      opened.close();
    }
  });
});

describe('rotas do dashboard', () => {
  let opened: OpenedDatabase;
  let project: Project;
  let app: FastifyInstance;

  beforeEach(async () => {
    opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    project = registerProject(opened.db, {
      name: 'projeto-dashboard',
      rootPath: path.resolve('/tmp/projeto-dashboard'),
    });
    app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
      config: createDefaultConfig({
        name: 'projeto-dashboard',
        rootPath: '/tmp/projeto-dashboard',
      }),
      gitInfo: { branch: 'main', commitHash: 'abcdef1234567890' },
    });
  });

  afterEach(async () => {
    await app.close();
    opened.close();
  });

  it('filtra eventos por busca textual e período', async () => {
    insertChangeEvents(opened.db, [
      {
        projectId: project.id,
        filePath: 'src/api/users.ts',
        changeType: 'change',
        diff: '+a',
        layer: 'backend',
        summary: 'Criou usuário',
        createdAt: '2026-01-01T10:00:00.000Z',
      },
      {
        projectId: project.id,
        filePath: 'src/components/Button.tsx',
        changeType: 'change',
        diff: '+b',
        layer: 'frontend',
        summary: 'Ajustou botão',
        createdAt: '2026-01-02T10:00:00.000Z',
      },
    ]);

    const search = await app.inject({ method: 'GET', url: '/api/events?q=bot%C3%A3o' });
    const searchBody = search.json() as { events: Array<{ filePath: string; additions: number }> };
    expect(searchBody.events).toHaveLength(1);
    expect(searchBody.events[0]?.filePath).toBe('src/components/Button.tsx');
    expect(searchBody.events[0]?.additions).toBe(1);

    const period = await app.inject({
      method: 'GET',
      url: '/api/events?from=2026-01-02T00:00:00.000Z&to=2026-01-02T23:59:59.000Z',
    });
    const periodBody = period.json() as { events: Array<{ filePath: string }> };
    expect(periodBody.events).toHaveLength(1);
    expect(periodBody.events[0]?.filePath).toBe('src/components/Button.tsx');

    const invalid = await app.inject({ method: 'GET', url: '/api/events?from=ontem' });
    expect(invalid.statusCode).toBe(400);
  });

  it('lista snapshots e estatísticas agregadas', async () => {
    insertSnapshot(opened.db, {
      projectId: project.id,
      commitHash: 'aaaaaaa1111',
      createdAt: '2026-01-01T09:00:00.000Z',
    });
    insertSnapshot(opened.db, {
      projectId: project.id,
      commitHash: 'bbbbbbb2222',
      createdAt: '2026-01-02T09:00:00.000Z',
    });

    insertChangeEvents(opened.db, [
      {
        projectId: project.id,
        filePath: 'src/api/users.ts',
        changeType: 'change',
        diff: '+a\n-b',
        layer: 'backend',
        batchId: 'lote-1',
        summary: 'Backend mudou',
        createdAt: '2026-01-01T10:00:00.000Z',
      },
      {
        projectId: project.id,
        filePath: 'db/schema.sql',
        changeType: 'change',
        diff: '+c',
        layer: 'database',
        batchId: 'lote-1',
        summary: 'Banco mudou',
        createdAt: '2026-01-01T10:00:01.000Z',
      },
      {
        projectId: project.id,
        filePath: 'src/api/users.ts',
        changeType: 'change',
        diff: '+d',
        layer: 'backend',
        batchId: 'lote-2',
        summary: 'Backend de novo',
        createdAt: '2026-01-02T11:00:00.000Z',
      },
    ]);

    const snapshots = await app.inject({ method: 'GET', url: '/api/snapshots' });
    const snapshotsBody = snapshots.json() as { snapshots: Array<{ commitHash: string }> };
    expect(snapshotsBody.snapshots.map((snapshot) => snapshot.commitHash)).toEqual([
      'bbbbbbb2222',
      'aaaaaaa1111',
    ]);

    const stats = await app.inject({ method: 'GET', url: '/api/stats' });
    const body = stats.json() as {
      totalEvents: number;
      totalBatches: number;
      totalFiles: number;
      byDay: Array<{ date: string; events: number; batches: number }>;
      byLayer: Array<{ layer: string; events: number }>;
      topFiles: Array<{ filePath: string; events: number }>;
    };

    expect(body.totalEvents).toBe(3);
    expect(body.totalBatches).toBe(2);
    expect(body.totalFiles).toBe(2);
    expect(body.byDay).toHaveLength(2);
    expect(body.byDay[0]?.date).toBe('2026-01-02');
    expect(body.byLayer[0]).toEqual({ layer: 'backend', events: 2 });
    expect(body.topFiles[0]).toMatchObject({ filePath: 'src/api/users.ts', events: 2 });
  });

  it('devolve o histórico de um arquivo', async () => {
    insertChangeEvents(opened.db, [
      {
        projectId: project.id,
        filePath: 'src/api/users.ts',
        changeType: 'change',
        diff: '+a',
        layer: 'backend',
        batchId: 'lote-1',
        summary: 'Um',
        createdAt: '2026-01-01T10:00:00.000Z',
      },
      {
        projectId: project.id,
        filePath: 'src/api/users.ts',
        changeType: 'change',
        diff: '+b',
        layer: 'backend',
        batchId: 'lote-2',
        summary: 'Dois',
        createdAt: '2026-01-02T10:00:00.000Z',
      },
      {
        projectId: project.id,
        filePath: 'src/outro.ts',
        changeType: 'change',
        diff: '+c',
        layer: 'backend',
        batchId: 'lote-3',
        summary: 'Outro',
        createdAt: '2026-01-02T11:00:00.000Z',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/files/events?path=src%2Fapi%2Fusers.ts',
    });
    const body = response.json() as {
      filePath: string;
      events: Array<{ filePath: string; summary: string }>;
    };

    expect(body.filePath).toBe('src/api/users.ts');
    expect(body.events).toHaveLength(2);
    expect(body.events[0]?.summary).toBe('Dois');

    const missing = await app.inject({ method: 'GET', url: '/api/files/events' });
    expect(missing.statusCode).toBe(400);
  });

  it('expõe config sanitizada e não inclui chaves', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    const body = response.json() as { llm: { provider: string; model: string | null } };
    expect(body.llm.provider).toBe('none');
    expect(body.llm.model).toBeNull();
    expect(JSON.stringify(response.json())).not.toContain('API_KEY');
  });

  it('POST /api/ai/test responde para provider none', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/ai/test' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      provider: 'none',
      elapsedMs: 0,
    });
  });

  it('POST /api/ai/test explica erro de configuração sem rede', async () => {
    const opened2 = openDatabase(':memory:');
    applyMigrations(opened2.db);
    const project2 = registerProject(opened2.db, {
      name: 'projeto-ia',
      rootPath: path.resolve('/tmp/projeto-ia-config'),
    });
    const config = createDefaultConfig({
      name: 'projeto-ia',
      rootPath: '/tmp/projeto-ia-config',
      provider: 'openai-compatible',
      model: 'modelo',
      baseUrl: null,
    });
    const app2 = await createServer({
      db: opened2.db,
      project: project2,
      version: '1.2.3',
      webDistPath: null,
      config,
    });

    try {
      const response = await app2.inject({ method: 'POST', url: '/api/ai/test' });
      const body = response.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('base_url');
    } finally {
      await app2.close();
      opened2.close();
    }
  });

  it('inclui branch e commit no /api/project', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/project' });
    expect(response.json()).toMatchObject({
      branch: 'main',
      commitHash: 'abcdef1234567890',
    });
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
        additions: 1,
        deletions: 0,
        diffTruncated: false,
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
