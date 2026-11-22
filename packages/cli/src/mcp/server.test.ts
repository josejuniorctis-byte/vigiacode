import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { Architect } from '../architect/index.js';
import { createBindingsScanner } from '../bindings/index.js';
import { createDefaultConfig } from '../config.js';
import {
  applyMigrations,
  listRoadmapItems,
  openDatabase,
  registerProject,
  type OpenedDatabase,
} from '../db/index.js';
import { createMcpServer } from './server.js';

const FIXTURES = path.resolve(process.cwd(), 'test/fixtures');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function parseTool(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Resposta MCP sem conteúdo de texto.');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('servidor MCP', () => {
  it('expõe ferramentas, recursos e prompt com respostas no formato esperado', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vigiacode-mcp-'));
    tempDirs.push(root);
    cpSync(path.join(FIXTURES, 'react-fastify-drizzle'), root, { recursive: true });

    const opened: OpenedDatabase = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, { name: 'mcp', rootPath: root });
    const config = createDefaultConfig({ name: 'mcp', rootPath: root });
    const scanner = createBindingsScanner({ db: opened.db, project, config });
    const architect = new Architect({ db: opened.db, project, config });
    await scanner.scan({ trigger: 'manual' });
    architect.generate();

    const server = createMcpServer({
      opened,
      project,
      config,
      scanner,
      architect,
      version: '0.0.0-test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'vitest', version: '1.0.0' });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'vigiacode_bindings',
        'vigiacode_check_entity',
        'vigiacode_recent_changes',
        'vigiacode_roadmap',
        'vigiacode_roadmap_update',
        'vigiacode_scan',
        'vigiacode_status',
      ]);

      const status = parseTool(await client.callTool({ name: 'vigiacode_status', arguments: {} }));
      expect(status).toMatchObject({
        project: { name: 'mcp' },
        bindings: expect.objectContaining({ red: expect.any(Number), profile: expect.any(String) }),
        roadmap: expect.objectContaining({ todo: expect.any(Number) }),
      });

      const red = parseTool(
        await client.callTool({
          name: 'vigiacode_bindings',
          arguments: { status: 'red', limit: 50 },
        }),
      );
      const redBindings = red.bindings as Array<{ ruleId: string; refs: Record<string, unknown> }>;
      expect(redBindings.length).toBeGreaterThan(0);
      expect(redBindings[0]).toHaveProperty('ruleId');
      expect(redBindings[0]?.refs).toHaveProperty('front');

      const entity = parseTool(
        await client.callTool({
          name: 'vigiacode_check_entity',
          arguments: { entity: 'user' },
        }),
      );
      expect(entity).toMatchObject({ entity: 'user', found: true, matrix: expect.any(Object) });

      const roadmap = parseTool(
        await client.callTool({ name: 'vigiacode_roadmap', arguments: { limit: 50 } }),
      );
      const items = roadmap.items as Array<{ id: string }>;
      expect(items.length).toBeGreaterThan(0);

      const updated = parseTool(
        await client.callTool({
          name: 'vigiacode_roadmap_update',
          arguments: { id: items[0]!.id, status: 'doing', note: 'iniciado via MCP' },
        }),
      );
      expect(updated).toMatchObject({
        updated: true,
        item: expect.objectContaining({ status: 'doing' }),
      });

      const changes = parseTool(
        await client.callTool({
          name: 'vigiacode_recent_changes',
          arguments: { limit: 5 },
        }),
      );
      expect(Array.isArray(changes.events)).toBe(true);

      const scan = parseTool(
        await client.callTool({
          name: 'vigiacode_scan',
          arguments: { changedFiles: ['src/pages/UsersPage.tsx'] },
        }),
      );
      expect(scan).toMatchObject({
        incremental: true,
        before: expect.objectContaining({ red: expect.any(Number) }),
        after: expect.objectContaining({ red: expect.any(Number) }),
        delta: expect.objectContaining({ red: expect.any(Number) }),
      });

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri).sort()).toEqual([
        'vigiacode://matrix',
        'vigiacode://roadmap',
        'vigiacode://summary',
      ]);
      const summary = await client.readResource({ uri: 'vigiacode://summary' });
      expect(summary.contents[0]).toMatchObject({ mimeType: 'application/json' });

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain('antes-de-codar');
      const prompt = await client.getPrompt({
        name: 'antes-de-codar',
        arguments: { objetivo: 'checkout' },
      });
      expect(prompt.messages[0]?.content).toMatchObject({ type: 'text' });

      const doing = listRoadmapItems(opened.db, project.id, { status: 'doing' });
      expect(doing).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
      opened.close();
    }
  });
});
