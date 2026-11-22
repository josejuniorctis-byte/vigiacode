import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../config.js';
import {
  applyMigrations,
  listChangeEvents,
  openDatabase,
  registerProject,
  type ChangeEvent,
  type VigiaCodeDatabase,
  type Project,
} from '../db/index.js';
import type { EventStreamMessage } from '../server/hub.js';
import { EventHub } from '../server/hub.js';
import { SummaryQueue, type Summarizer } from '../ai/index.js';
import type { GitRepository } from '../git/index.js';
import { ChangeRecorder } from './recorder.js';

interface RecorderFixture {
  db: VigiaCodeDatabase;
  project: Project;
  hub: EventHub;
  messages: EventStreamMessage[];
  queue: SummaryQueue;
  recorder: ChangeRecorder;
  close(): void;
}

function createFixture(summarizer: Summarizer, withGit = true): RecorderFixture {
  const opened = openDatabase(':memory:');
  applyMigrations(opened.db);
  const project = registerProject(opened.db, {
    name: 'demo',
    rootPath: 'C:/projetos/demo',
  });
  const config = createDefaultConfig({ name: 'demo', rootPath: 'C:/projetos/demo' });
  const hub = new EventHub();
  const messages: EventStreamMessage[] = [];
  hub.subscribe((message) => messages.push(message));
  const queue = new SummaryQueue();

  const git = withGit
    ? ({
        diffForFile: async (change: { path: string }) => ({
          diff: change.path.includes('api') ? '+const rota = 1;' : '+export const ui = 1;',
          truncated: false,
        }),
        headHash: async () => null,
      } as unknown as GitRepository)
    : null;

  const recorder = new ChangeRecorder({
    db: opened.db,
    project,
    config,
    git,
    summarizer,
    hub,
    queue,
  });

  return {
    db: opened.db,
    project,
    hub,
    messages,
    queue,
    recorder,
    close: () => opened.close(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ChangeRecorder', () => {
  it('grava o lote com diff/layer e preenche o resumo depois', async () => {
    const gate = deferred<string>();
    const summarizer: Summarizer = {
      provider: 'ollama',
      summarize: () => gate.promise,
    };
    const fixture = createFixture(summarizer);

    try {
      const recorded = await fixture.recorder.handleBatch([
        { path: 'src/api/users.ts', changeType: 'change' },
        { path: 'src/components/Button.tsx', changeType: 'add' },
      ]);

      expect(recorded).not.toBeNull();
      expect(recorded?.events).toHaveLength(2);

      const rows = listChangeEvents(fixture.db, fixture.project.id);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.batchId)).size).toBe(1);
      expect(rows.map((row) => row.layer).sort()).toEqual(['backend', 'frontend']);
      expect(rows.every((row) => row.summary === null)).toBe(true);
      expect(rows.every((row) => row.diff.length > 0)).toBe(true);
      expect(fixture.messages.filter((message) => message.type === 'change')).toHaveLength(2);

      gate.resolve('Resumo vindo da IA.');
      await fixture.queue.drain(3000);

      const updated = listChangeEvents(fixture.db, fixture.project.id);
      expect(updated.every((row) => row.summary === 'Resumo vindo da IA.')).toBe(true);
      expect(fixture.messages.filter((message) => message.type === 'summary')).toHaveLength(2);
    } finally {
      fixture.close();
    }
  });

  it('usa resumo heurístico quando a IA lança erro', async () => {
    const summarizer: Summarizer = {
      provider: 'ollama',
      summarize: async () => {
        throw new Error('IA fora do ar');
      },
    };
    const fixture = createFixture(summarizer);

    try {
      await fixture.recorder.handleBatch([{ path: 'src/api/users.ts', changeType: 'change' }]);
      await fixture.queue.drain(3000);

      const [row] = listChangeEvents(fixture.db, fixture.project.id) as ChangeEvent[];
      expect(row?.summary).toContain('1 arquivo alterado');
      expect(row?.summary).toContain('backend');
    } finally {
      fixture.close();
    }
  });

  it('funciona sem git, registrando diff vazio', async () => {
    const summarizer: Summarizer = {
      provider: 'none',
      summarize: async () => 'Resumo heurístico.',
    };
    const fixture = createFixture(summarizer, false);

    try {
      await fixture.recorder.handleBatch([{ path: 'src/api/users.ts', changeType: 'change' }]);
      await fixture.queue.drain(3000);

      const [row] = listChangeEvents(fixture.db, fixture.project.id) as ChangeEvent[];
      expect(row?.diff).toBe('');
      expect(row?.diffTruncated).toBe(false);
      expect(row?.layer).toBe('backend');
    } finally {
      fixture.close();
    }
  });
});
