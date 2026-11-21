import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../config.js';
import { runInit } from './init.js';

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeanchor-init-'));
  tempDirs.push(dir);
  return dir;
}

function withDatabase<T>(databasePath: string, fn: (sqlite: Database.Database) => T): T {
  const sqlite = new Database(databasePath);
  try {
    return fn(sqlite);
  } finally {
    sqlite.close();
  }
}

function tableNames(databasePath: string): string[] {
  return withDatabase(databasePath, (sqlite) =>
    sqlite
      .prepare<[], { name: string }>("select name from sqlite_master where type = 'table'")
      .all()
      .map((row) => row.name),
  );
}

function indexNames(databasePath: string): string[] {
  return withDatabase(databasePath, (sqlite) =>
    sqlite
      .prepare<[], { name: string }>("select name from sqlite_master where type = 'index'")
      .all()
      .map((row) => row.name),
  );
}

function projectRows(databasePath: string): Array<{ name: string; root_path: string }> {
  return withDatabase(databasePath, (sqlite) =>
    sqlite
      .prepare<[], { name: string; root_path: string }>('select name, root_path from projects')
      .all(),
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('codeanchor init', () => {
  it('cria .codeanchor/, o banco, as tabelas e registra o projeto', async () => {
    const projectRoot = makeProjectDir();

    const result = await runInit({ cwd: projectRoot, yes: true });

    expect(result.status).toBe('created');

    const configPath = path.join(projectRoot, '.codeanchor', 'config.json');
    const databasePath = path.join(projectRoot, '.codeanchor', 'codeanchor.db');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(databasePath)).toBe(true);

    const config = readConfig(projectRoot);
    expect(config.project.name).toBe(path.basename(projectRoot));
    expect(config.project.rootPath).toBe(projectRoot);
    expect(config.llm.provider).toBe('none');
    expect(config.watch.ignore).toContain('node_modules');
    expect(config.server.port).toBe(4317);
    expect(config.database.file).toBe('codeanchor.db');

    expect(tableNames(databasePath)).toEqual(
      expect.arrayContaining(['projects', 'snapshots', 'change_events', 'bindings']),
    );

    expect(indexNames(databasePath)).toEqual(
      expect.arrayContaining([
        'snapshots_project_id_idx',
        'change_events_project_id_idx',
        'bindings_project_id_idx',
      ]),
    );

    expect(projectRows(databasePath)).toEqual([
      { name: path.basename(projectRoot), root_path: projectRoot },
    ]);
  });

  it('grava o provider de IA escolhido', async () => {
    const projectRoot = makeProjectDir();

    const result = await runInit({ cwd: projectRoot, yes: true, provider: 'openai' });

    expect(result.config?.llm.provider).toBe('openai');
    expect(readConfig(projectRoot).llm.provider).toBe('openai');
    expect(readConfig(projectRoot).llm.model).toBe('gpt-4o-mini');
  });

  it('exige base_url e modelo para openai-compatible', async () => {
    const projectRoot = makeProjectDir();

    await expect(
      runInit({ cwd: projectRoot, yes: true, provider: 'openai-compatible' }),
    ).rejects.toThrow(/base-url/);

    await expect(
      runInit({
        cwd: projectRoot,
        yes: true,
        provider: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    ).rejects.toThrow(/modelo/);
  });

  it('adiciona .codeanchor/ ao .gitignore existente com --yes', async () => {
    const projectRoot = makeProjectDir();
    const gitignorePath = path.join(projectRoot, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules\ndist\n', 'utf8');

    const result = await runInit({ cwd: projectRoot, yes: true });

    expect(result.gitignore).toBe('added');
    const content = readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('.codeanchor/');
    expect(content.startsWith('node_modules\ndist\n')).toBe(true);
  });

  it('pergunta antes de mexer no .gitignore e respeita a recusa', async () => {
    const projectRoot = makeProjectDir();
    const gitignorePath = path.join(projectRoot, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules\n', 'utf8');

    let asked = '';
    const result = await runInit({
      cwd: projectRoot,
      confirm: async (question) => {
        asked = question;
        return false;
      },
    });

    expect(asked).toContain('.gitignore');
    expect(result.gitignore).toBe('skipped');
    expect(readFileSync(gitignorePath, 'utf8')).not.toContain('.codeanchor');
  });

  it('avisa quando o .gitignore não existe e não cria o arquivo', async () => {
    const projectRoot = makeProjectDir();

    const result = await runInit({ cwd: projectRoot, yes: true });

    expect(result.gitignore).toBe('missing');
    expect(existsSync(path.join(projectRoot, '.gitignore'))).toBe(false);
  });

  it('não sobrescreve a configuração de um projeto já inicializado', async () => {
    const projectRoot = makeProjectDir();
    await runInit({ cwd: projectRoot, name: 'original', yes: true });

    const configPath = path.join(projectRoot, '.codeanchor', 'config.json');
    const original = JSON.parse(readFileSync(configPath, 'utf8')) as {
      project: { name: string; rootPath: string };
    };
    original.project.name = 'editado-a-mao';
    writeFileSync(configPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');

    const result = await runInit({ cwd: projectRoot, name: 'novo-nome', yes: true });

    expect(result.status).toBe('already-initialized');
    expect(result.projectId).toBeNull();
    expect(readConfig(projectRoot).project.name).toBe('editado-a-mao');
    expect(projectRows(path.join(projectRoot, '.codeanchor', 'codeanchor.db'))).toHaveLength(1);
  });

  it('recria a configuração com --force mantendo um único registro de projeto', async () => {
    const projectRoot = makeProjectDir();
    await runInit({ cwd: projectRoot, name: 'primeiro', yes: true });

    const result = await runInit({ cwd: projectRoot, name: 'segundo', force: true, yes: true });

    expect(result.status).toBe('reinitialized');
    expect(readConfig(projectRoot).project.name).toBe('segundo');

    const databasePath = path.join(projectRoot, '.codeanchor', 'codeanchor.db');
    expect(projectRows(databasePath)).toEqual([{ name: 'segundo', root_path: projectRoot }]);
  });
});
