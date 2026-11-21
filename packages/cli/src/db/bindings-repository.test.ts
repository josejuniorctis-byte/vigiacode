import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptBinding,
  applyMigrations,
  finishBindingScan,
  insertBindingScan,
  listBindings,
  openDatabase,
  registerProject,
  resolveBindingsNotSeen,
  summarizeBindings,
  upsertBinding,
  type OpenedDatabase,
} from './index.js';
import type { Project } from './schema.js';

describe('repositório de amarrações', () => {
  let opened: OpenedDatabase;
  let project: Project;

  beforeEach(() => {
    opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    project = registerProject(opened.db, { name: 'teste', rootPath: '/tmp/teste' });
  });

  afterEach(() => {
    opened.close();
  });

  function upsert(input: {
    ruleId?: string;
    layer?: 'frontend' | 'backend' | 'database';
    entity?: string;
    field?: string;
    status?: 'red' | 'yellow' | 'green';
  }) {
    return upsertBinding(opened.db, {
      projectId: project.id,
      ruleId: input.ruleId ?? 'R1',
      layer: input.layer ?? 'backend',
      entity: input.entity ?? 'user',
      field: input.field ?? 'phone',
      status: input.status ?? 'red',
      severity: input.status ?? 'red',
      message: 'mensagem',
      frontRef: 'src/front.ts:1',
      backRef: 'src/back.ts:2',
      suggestion: 'sugestão',
    });
  }

  it('faz upsert pela identidade e reabre uma amarração resolvida', () => {
    const first = upsert({});
    expect(first.created).toBe(true);

    const second = upsert({ status: 'yellow' });
    expect(second.created).toBe(false);
    expect(second.reopened).toBe(false);
    expect(second.binding.status).toBe('yellow');
    expect(second.binding.firstSeenAt).toBe(first.binding.firstSeenAt);

    resolveBindingsNotSeen(opened.db, project.id, new Set());
    const resolved = listBindings(opened.db, project.id, { includeResolved: true })[0];
    expect(resolved?.resolvedAt).not.toBeNull();

    const reopened = upsert({});
    expect(reopened.reopened).toBe(true);
    expect(reopened.binding.resolvedAt).toBeNull();
  });

  it('resume apenas ativas e ignora aceitas nas contagens', () => {
    upsert({ field: 'red', status: 'red' });
    upsert({ field: 'yellow', status: 'yellow' });
    upsert({ field: 'green', status: 'green' });
    const accepted = upsert({ field: 'accepted', status: 'red' });
    acceptBinding(opened.db, accepted.binding.id);

    const summary = summarizeBindings(opened.db, project.id, null);

    expect(summary).toMatchObject({
      red: 1,
      yellow: 1,
      green: 1,
      active: 3,
      accepted: 1,
      healthPercent: 33,
    });
    expect(summary.byRule.find((row) => row.ruleId === 'R1')?.red).toBe(1);
    expect(listBindings(opened.db, project.id)).toHaveLength(3);
    expect(listBindings(opened.db, project.id, { includeAccepted: true })).toHaveLength(4);
  });

  it('registra scans com contagens e histórico', () => {
    const scan = insertBindingScan(opened.db, { projectId: project.id, trigger: 'manual' });
    const finished = finishBindingScan(opened.db, scan.id, {
      filesScanned: 3,
      red: 1,
      yellow: 2,
      green: 3,
      created: 6,
      resolved: 0,
      matrixJson: '{"entities":[]}',
    });

    expect(finished).toMatchObject({
      filesScanned: 3,
      redCount: 1,
      yellowCount: 2,
      greenCount: 3,
      createdCount: 6,
    });
    // `lastScan` do summary usa o scan mais recente.
    expect(summarizeBindings(opened.db, project.id).lastScan?.id).toBe(scan.id);
  });
});
