import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBindingsScanner } from '../bindings/index.js';
import { createDefaultConfig } from '../config.js';
import {
  acceptBinding,
  applyMigrations,
  insertBindingScan,
  openDatabase,
  registerProject,
  resolveBindingsNotSeen,
  upsertBinding,
  type OpenedDatabase,
} from '../db/index.js';
import type { BindingStatus, Project } from '../db/schema.js';
import { createServer } from './index.js';

const FIXTURE = path.resolve(process.cwd(), 'test/fixtures/react-fastify-drizzle');

function seedBinding(
  opened: OpenedDatabase,
  project: Project,
  input: {
    ruleId?: string;
    layer?: 'frontend' | 'backend' | 'database';
    entity?: string;
    field?: string;
    status?: BindingStatus;
  },
) {
  return upsertBinding(opened.db, {
    projectId: project.id,
    ruleId: input.ruleId ?? 'R1',
    layer: input.layer ?? 'backend',
    entity: input.entity ?? 'user',
    field: input.field ?? 'phone',
    status: input.status ?? 'red',
    severity: input.status ?? 'red',
    message: `[${input.ruleId ?? 'R1'}] mensagem de ${input.field ?? 'phone'}`,
    frontRef: 'src/pages/UsersPage.tsx:10',
    backRef: 'server/routes/users.ts:2',
    suggestion: 'adicione o campo',
  }).binding;
}

describe('API de amarrações', () => {
  let opened: OpenedDatabase;
  let project: Project;
  let app: FastifyInstance;

  beforeEach(async () => {
    opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    project = registerProject(opened.db, {
      name: 'bindings-api',
      rootPath: path.resolve('/tmp/bindings-api'),
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

  it('lista com filtros de status, camada, regra, entidade e busca', async () => {
    seedBinding(opened, project, { field: 'phone', status: 'red' });
    seedBinding(opened, project, {
      ruleId: 'R2',
      entity: 'user',
      field: 'nickname',
      status: 'yellow',
    });
    seedBinding(opened, project, {
      ruleId: 'GREEN',
      entity: 'user',
      field: 'name',
      status: 'green',
    });

    const all = await app.inject({ method: 'GET', url: '/api/bindings' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { bindings: unknown[] }).bindings).toHaveLength(3);

    const red = await app.inject({ method: 'GET', url: '/api/bindings?status=red' });
    expect(
      (red.json() as { bindings: Array<{ field: string }> }).bindings.map((b) => b.field),
    ).toEqual(['phone']);

    const backend = await app.inject({ method: 'GET', url: '/api/bindings?layer=backend' });
    expect((backend.json() as { bindings: unknown[] }).bindings).toHaveLength(3);

    const rule = await app.inject({ method: 'GET', url: '/api/bindings?rule=R2' });
    expect((rule.json() as { bindings: Array<{ field: string }> }).bindings[0]?.field).toBe(
      'nickname',
    );

    const entity = await app.inject({ method: 'GET', url: '/api/bindings?entity=user' });
    expect((entity.json() as { bindings: unknown[] }).bindings).toHaveLength(3);

    const search = await app.inject({ method: 'GET', url: '/api/bindings?q=nickname' });
    expect((search.json() as { bindings: Array<{ field: string }> }).bindings[0]?.field).toBe(
      'nickname',
    );

    const invalidStatus = await app.inject({ method: 'GET', url: '/api/bindings?status=blue' });
    expect(invalidStatus.statusCode).toBe(400);
    const invalidLayer = await app.inject({ method: 'GET', url: '/api/bindings?layer=nope' });
    expect(invalidLayer.statusCode).toBe(400);
    const invalidRule = await app.inject({ method: 'GET', url: '/api/bindings?rule=R99' });
    expect(invalidRule.statusCode).toBe(400);
    const invalidLimit = await app.inject({ method: 'GET', url: '/api/bindings?limit=0' });
    expect(invalidLimit.statusCode).toBe(400);
  });

  it('inclui resolvidas e aceitas só quando pedido', async () => {
    seedBinding(opened, project, { field: 'phone' });
    const accepted = seedBinding(opened, project, { field: 'nickname', status: 'yellow' });
    acceptBinding(opened.db, accepted.id);
    resolveBindingsNotSeen(opened.db, project.id, new Set());

    const active = await app.inject({ method: 'GET', url: '/api/bindings' });
    expect((active.json() as { bindings: unknown[] }).bindings).toHaveLength(0);

    const resolved = await app.inject({
      method: 'GET',
      url: '/api/bindings?includeResolved=true&includeAccepted=true',
    });
    const body = resolved.json() as { bindings: Array<{ accepted: boolean; resolvedAt: string }> };
    expect(body.bindings).toHaveLength(2);
    expect(body.bindings.some((binding) => binding.accepted)).toBe(true);
    expect(body.bindings.every((binding) => binding.resolvedAt !== null)).toBe(true);
  });

  it('devolve detalhe, 404 e aceita falso positivo', async () => {
    const binding = seedBinding(opened, project, { field: 'phone' });

    const detail = await app.inject({ method: 'GET', url: `/api/bindings/${binding.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: binding.id, field: 'phone' });

    const missing = await app.inject({ method: 'GET', url: '/api/bindings/nao-existe' });
    expect(missing.statusCode).toBe(404);

    const accept = await app.inject({
      method: 'POST',
      url: `/api/bindings/${binding.id}/accept`,
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ accepted: true });

    const list = await app.inject({ method: 'GET', url: '/api/bindings' });
    expect((list.json() as { bindings: unknown[] }).bindings).toHaveLength(0);
  });

  it('expõe summary, matriz vazia e histórico de scans', async () => {
    seedBinding(opened, project, { field: 'phone', status: 'red' });
    seedBinding(opened, project, {
      ruleId: 'GREEN',
      entity: 'user',
      field: 'name',
      status: 'green',
    });
    insertBindingScan(opened.db, { projectId: project.id, trigger: 'manual' });

    const summary = await app.inject({ method: 'GET', url: '/api/bindings/summary' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ red: 1, green: 1, healthPercent: 50 });

    const matrix = await app.inject({ method: 'GET', url: '/api/bindings/matrix' });
    expect(matrix.statusCode).toBe(200);
    expect(matrix.json()).toMatchObject({ entities: [], scanId: null });

    const scans = await app.inject({ method: 'GET', url: '/api/bindings/scans' });
    expect(scans.statusCode).toBe(200);
    expect((scans.json() as { scans: unknown[] }).scans).toHaveLength(1);
  });

  it('explica com heurística quando não há IA', async () => {
    const binding = seedBinding(opened, project, { field: 'phone' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/bindings/${binding.id}/explain`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      bindingId: binding.id,
      provider: 'none',
      heuristic: true,
    });
    expect((response.json() as { suggestion: string }).suggestion).toContain('interface UserDto');
  });

  it('aceita um explicador injetado', async () => {
    const binding = seedBinding(opened, project, { field: 'phone' });
    const app2 = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
      explainBinding: async () => ({
        bindingId: binding.id,
        provider: 'ollama',
        model: 'llama3.2',
        heuristic: false,
        explanation: 'Explicação vinda do provider.',
        suggestion: '// código',
      }),
    });

    try {
      const response = await app2.inject({
        method: 'POST',
        url: `/api/bindings/${binding.id}/explain`,
      });
      expect(response.json()).toMatchObject({
        provider: 'ollama',
        explanation: 'Explicação vinda do provider.',
      });
    } finally {
      await app2.close();
    }
  });
});

describe('POST /api/bindings/scan', () => {
  it('roda o scanner e preenche a matriz', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name: 'fixture', rootPath: FIXTURE });
    const config = createDefaultConfig({ name: 'fixture', rootPath: FIXTURE });
    const scanner = createBindingsScanner({ db: opened.db, project, config });
    const app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
      config,
      bindingsScanner: scanner,
    });

    try {
      const scan = await app.inject({ method: 'POST', url: '/api/bindings/scan' });
      expect(scan.statusCode).toBe(200);
      expect(scan.json()).toMatchObject({
        trigger: 'manual',
        summary: expect.objectContaining({ red: 4 }),
      });

      const matrix = await app.inject({ method: 'GET', url: '/api/bindings/matrix' });
      const body = matrix.json() as { entities: Array<{ entity: string; link: string }> };
      expect(body.entities.find((row) => row.entity === 'user')?.link).toBe('partial');

      const list = await app.inject({ method: 'GET', url: '/api/bindings?status=red' });
      expect((list.json() as { bindings: unknown[] }).bindings).toHaveLength(4);
    } finally {
      await app.close();
      opened.close();
    }
  });

  it('devolve 503 sem scanner', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'sem-scanner',
      rootPath: '/tmp/sem-scanner',
    });
    const app = await createServer({
      db: opened.db,
      project,
      version: '1.2.3',
      webDistPath: null,
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/api/bindings/scan' });
      expect(response.statusCode).toBe(503);
    } finally {
      await app.close();
      opened.close();
    }
  });
});
