import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../config.js';
import { createBindingsScanner, type BindingsScanner } from '../bindings/index.js';
import {
  applyMigrations,
  findRoadmapItem,
  listBindings,
  listRoadmapItems,
  openDatabase,
  registerProject,
  type OpenedDatabase,
} from '../db/index.js';
import type { Project } from '../db/schema.js';
import { Architect } from './index.js';

const FIXTURES = path.resolve(process.cwd(), 'test/fixtures');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

interface Setup {
  opened: OpenedDatabase;
  scanner: BindingsScanner;
  architect: Architect;
  project: Project;
  root: string;
}

function setup(): Setup {
  const root = mkdtempSync(path.join(tmpdir(), 'vigiacode-architect-'));
  tempDirs.push(root);
  cpSync(path.join(FIXTURES, 'react-fastify-drizzle'), root, { recursive: true });

  const opened = openDatabase(':memory:');
  applyMigrations(opened.db);
  const project = registerProject(opened.db, { name: 'architect', rootPath: root });
  const config = createDefaultConfig({ name: 'architect', rootPath: root });
  const scanner = createBindingsScanner({ db: opened.db, project, config });
  const architect = new Architect({ db: opened.db, project, config });
  return { opened, scanner, architect, project, root };
}

describe('Arquiteto (roadmap determinístico)', () => {
  it('agrupa as amarrações 🔴 por entidade e fecha o item quando a quebra é corrigida', async () => {
    const { opened, scanner, architect, project, root } = setup();
    try {
      const scan = await scanner.scan({ trigger: 'manual' });
      architect.generate({ scanId: scan?.scan.id ?? null });

      const bindingItems = listRoadmapItems(opened.db, project.id, { kind: 'binding' });
      // Três entidades têm amarração 🔴 no fixture (user, order, missing_panel).
      expect(bindingItems).toHaveLength(3);
      expect(bindingItems.every((item) => item.priority === 'p1')).toBe(true);

      const userItems = bindingItems.filter((item) => item.sourceRef === 'user');
      expect(userItems).toHaveLength(1);
      expect(userItems[0]?.title).toContain('user');

      const orderItem = bindingItems.find((item) => item.sourceRef === 'order');
      expect(orderItem?.status).toBe('todo');

      // Corrige a quebra R4 (GET /api/orders sem endpoint) criando a rota.
      writeFileSync(
        path.join(root, 'server/routes/orders.ts'),
        [
          "import type { FastifyInstance } from 'fastify';",
          '',
          'export async function orderRoutes(app: FastifyInstance): Promise<void> {',
          "  app.get('/api/orders', async () => []);",
          '}',
          '',
        ].join('\n'),
        'utf8',
      );

      const rescan = await scanner.scan({
        trigger: 'watch',
        batchId: 'fix-order',
        changedFiles: ['server/routes/orders.ts'],
      });
      expect(listBindings(opened.db, project.id, { rule: 'R4' })).toHaveLength(0);

      architect.generate({
        scanId: rescan?.scan.id ?? null,
        changedFiles: ['server/routes/orders.ts'],
      });

      const closed = orderItem ? findRoadmapItem(opened.db, orderItem.id) : undefined;
      expect(closed?.status).toBe('done');
      expect(closed?.doneAt).not.toBeNull();
      expect(closed?.evidence.some((entry) => entry.includes('scan'))).toBe(true);
      expect(closed?.checklist.every((entry) => entry.done)).toBe(true);
    } finally {
      opened.close();
    }
  });

  it('cria item para TODO adicionado e fecha quando o comentário é removido', async () => {
    const { opened, scanner, architect, project, root } = setup();
    const usersPage = path.join(root, 'src/pages/UsersPage.tsx');
    const original = readFileSync(usersPage, 'utf8');

    try {
      await scanner.scan({ trigger: 'manual' });
      architect.generate();

      writeFileSync(
        usersPage,
        original.replace(
          'import { UserCard }',
          '// TODO: validar telefone no submit\nimport { UserCard }',
        ),
        'utf8',
      );
      const added = await scanner.scan({
        trigger: 'watch',
        batchId: 'todo-added',
        changedFiles: ['src/pages/UsersPage.tsx'],
      });
      architect.generate({
        scanId: added?.scan.id ?? null,
        changedFiles: ['src/pages/UsersPage.tsx'],
      });

      const debts = listRoadmapItems(opened.db, project.id, { kind: 'debt' });
      expect(debts).toHaveLength(1);
      const debt = debts[0]!;
      expect(debt.status).toBe('todo');
      expect(debt.sourceRef).toBe('todo:pages');
      expect(debt.priority).toBe('p3');
      expect(debt.module).toBe('pages');
      expect(debt.evidence[0]).toContain('TODO src/pages/UsersPage.tsx:');
      expect(debt.checklist[0]?.label).toContain('Zerar 1 comentário');

      writeFileSync(usersPage, original, 'utf8');
      const removed = await scanner.scan({
        trigger: 'watch',
        batchId: 'todo-removed',
        changedFiles: ['src/pages/UsersPage.tsx'],
      });
      architect.generate({
        scanId: removed?.scan.id ?? null,
        changedFiles: ['src/pages/UsersPage.tsx'],
      });

      const closed = findRoadmapItem(opened.db, debt.id);
      expect(closed?.status).toBe('done');
      expect(closed?.evidence.join(' ')).toContain('não existe mais');
    } finally {
      opened.close();
    }
  });

  it('agrupa TODO/FIXME por módulo com prioridade p3 para TODO e p2 para FIXME/HACK', async () => {
    const { opened, scanner, architect, project, root } = setup();
    const usersPage = path.join(root, 'src/pages/UsersPage.tsx');
    const customersPage = path.join(root, 'src/pages/CustomersPage.tsx');
    const userCard = path.join(root, 'src/components/UserCard.tsx');
    const originals = new Map([
      [usersPage, readFileSync(usersPage, 'utf8')],
      [customersPage, readFileSync(customersPage, 'utf8')],
      [userCard, readFileSync(userCard, 'utf8')],
    ]);

    try {
      await scanner.scan({ trigger: 'manual' });
      const originalUsers = originals.get(usersPage)!;
      const originalCustomers = originals.get(customersPage)!;
      const originalCard = originals.get(userCard)!;
      writeFileSync(usersPage, `// TODO: validar telefone\n${originalUsers}`, 'utf8');
      writeFileSync(customersPage, `// TODO: paginar clientes\n${originalCustomers}`, 'utf8');
      writeFileSync(userCard, `// FIXME: corrigir layout\n${originalCard}`, 'utf8');

      architect.generate({
        changedFiles: [
          'src/pages/UsersPage.tsx',
          'src/pages/CustomersPage.tsx',
          'src/components/UserCard.tsx',
        ],
      });

      const debts = listRoadmapItems(opened.db, project.id, { kind: 'debt' });
      expect(debts).toHaveLength(2);

      const pages = debts.find((item) => item.module === 'pages');
      expect(pages?.sourceRef).toBe('todo:pages');
      expect(pages?.priority).toBe('p3');
      expect(pages?.evidence).toHaveLength(2);
      expect(pages?.title).toContain('2 TODO');

      const components = debts.find((item) => item.module === 'components');
      expect(components?.priority).toBe('p2');
      expect(components?.evidence[0]).toContain('FIXME src/components/UserCard.tsx:');
    } finally {
      for (const [file, content] of originals) writeFileSync(file, content, 'utf8');
      opened.close();
    }
  });

  it('gera plano heurístico quando não há provider de IA', async () => {
    const { opened, architect, project } = setup();
    try {
      const plan = await architect.plan('preparar checkout');
      expect(plan.heuristic).toBe(true);
      expect(plan.provider).toBe('none');
      expect(plan.items.length).toBeGreaterThan(0);
      expect(plan.items.every((item) => item.source === 'ai' && item.kind === 'feature')).toBe(
        true,
      );
      const stored = listRoadmapItems(opened.db, project.id, { kind: 'feature' });
      expect(stored).toHaveLength(plan.items.length);
    } finally {
      opened.close();
    }
  });
});
