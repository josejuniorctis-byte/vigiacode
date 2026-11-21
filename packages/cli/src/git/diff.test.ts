import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  getLatestSnapshot,
  openDatabase,
  registerProject,
  type Snapshot,
} from '../db/index.js';
import { GitRepository, truncateDiff } from './diff.js';
import { startHeadWatcher, syncSnapshot } from './snapshots.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeanchor-git-'));
  tempDirs.push(dir);
  return dir;
}

async function makeRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = makeTempDir();
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'codeanchor@test.dev');
  await git.addConfig('user.name', 'CodeAnchor Test');
  return { dir, git };
}

async function commitAll(git: SimpleGit, message: string): Promise<void> {
  await git.add(['.']);
  await git.commit(message);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!predicate()) throw new Error('timeout aguardando condição');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('GitRepository', () => {
  it('retorna diff de arquivo alterado e diff completo de arquivo novo', async () => {
    const { dir, git } = await makeRepo();
    writeFileSync(path.join(dir, 'app.ts'), 'const a = 1;\n', 'utf8');
    await commitAll(git, 'initial');

    writeFileSync(path.join(dir, 'app.ts'), 'const a = 2;\nconst b = 3;\n', 'utf8');
    writeFileSync(path.join(dir, 'novo.ts'), 'export const novo = true;\n', 'utf8');

    const repository = await GitRepository.open(dir);
    expect(repository).not.toBeNull();

    const changed = await repository!.diffForFile(
      { path: 'app.ts', changeType: 'change' },
      1_000_000,
    );
    expect(changed.diff).toContain('-const a = 1;');
    expect(changed.diff).toContain('+const a = 2;');
    expect(changed.diff).toContain('+const b = 3;');

    const added = await repository!.diffForFile({ path: 'novo.ts', changeType: 'add' }, 1_000_000);
    expect(added.diff).toContain('new file mode 100644');
    expect(added.diff).toContain('+export const novo = true;');
  });

  it('retorna diff de remoção para arquivo deletado', async () => {
    const { dir, git } = await makeRepo();
    writeFileSync(path.join(dir, 'remove.ts'), 'export const velho = true;\n', 'utf8');
    await commitAll(git, 'initial');

    rmSync(path.join(dir, 'remove.ts'));

    const repository = await GitRepository.open(dir);
    const removed = await repository!.diffForFile(
      { path: 'remove.ts', changeType: 'unlink' },
      1_000_000,
    );

    expect(removed.diff).toContain('deleted file mode');
    expect(removed.diff).toContain('-export const velho = true;');
  });

  it('trunca diffs acima do limite e marca a truncagem', async () => {
    const { dir, git } = await makeRepo();
    writeFileSync(path.join(dir, 'grande.ts'), 'const a = 1;\n', 'utf8');
    await commitAll(git, 'initial');
    writeFileSync(
      path.join(dir, 'grande.ts'),
      Array.from({ length: 500 }, (_, index) => `const linha${index} = ${index};`).join('\n'),
      'utf8',
    );

    const repository = await GitRepository.open(dir);
    const result = await repository!.diffForFile({ path: 'grande.ts', changeType: 'change' }, 512);

    expect(result.truncated).toBe(true);
    expect(result.diff).toContain('[diff truncado pelo CodeAnchor');
  });

  it('não é repositório git → open devolve null', async () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, 'arquivo.txt'), 'sem git', 'utf8');

    await expect(GitRepository.open(dir)).resolves.toBeNull();
  });
});

describe('truncateDiff', () => {
  it('preserva diffs pequenos', () => {
    const diff = 'abc';
    expect(truncateDiff(diff, 100)).toEqual({ diff, truncated: false });
  });

  it('respeita o limite de bytes sem quebrar UTF-8', () => {
    const diff = 'á'.repeat(300);
    const result = truncateDiff(diff, 200);
    expect(result.truncated).toBe(true);
    expect(result.diff).not.toContain('\uFFFD');
  });
});

describe('snapshots', () => {
  it('grava o HEAD apenas quando ele muda', async () => {
    const { dir, git } = await makeRepo();
    writeFileSync(path.join(dir, 'app.ts'), 'const a = 1;\n', 'utf8');
    await commitAll(git, 'initial');

    const repository = await GitRepository.open(dir);
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'demo',
      rootPath: dir,
    });

    try {
      const first = await syncSnapshot(opened.db, project.id, repository);
      expect(first).not.toBeNull();
      expect(getLatestSnapshot(opened.db, project.id)?.commitHash).toBe(first?.commitHash);

      const second = await syncSnapshot(opened.db, project.id, repository);
      expect(second).toBeNull();

      writeFileSync(path.join(dir, 'app.ts'), 'const a = 2;\n', 'utf8');
      await commitAll(git, 'segundo commit');

      const third = await syncSnapshot(opened.db, project.id, repository);
      expect(third).not.toBeNull();
      expect(third?.commitHash).not.toBe(first?.commitHash);
    } finally {
      opened.close();
    }
  });

  it('detecta commit novo por polling, mesmo sem edição de arquivos', async () => {
    const opened = openDatabase(':memory:');
    applyMigrations(opened.db);
    const project = registerProject(opened.db, {
      name: 'demo-polling',
      rootPath: 'C:/projetos/demo-polling',
    });

    const hashes = ['a'.repeat(40), 'b'.repeat(40)];
    let index = 0;
    const fakeGit = {
      headHash: async () => hashes[index] ?? null,
    } as unknown as GitRepository;

    const snapshots: Snapshot[] = [];
    const watcher = startHeadWatcher({
      db: opened.db,
      projectId: project.id,
      git: fakeGit,
      intervalMs: 20,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    try {
      await waitFor(() => snapshots.length === 1);
      expect(snapshots[0]?.commitHash).toBe(hashes[0]);

      index = 1;
      await waitFor(() => snapshots.length === 2);
      expect(snapshots[1]?.commitHash).toBe(hashes[1]);
    } finally {
      watcher.close();
      opened.close();
    }
  });
});
