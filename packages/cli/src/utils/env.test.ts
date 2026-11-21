import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProjectEnv, parseEnvLine } from './env.js';

const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeanchor-env-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadProjectEnv', () => {
  it('carrega .codeanchor/.env sem sobrescrever o ambiente existente', () => {
    const projectRoot = makeProject();
    mkdirSync(path.join(projectRoot, '.codeanchor'), { recursive: true });
    writeFileSync(
      path.join(projectRoot, '.codeanchor', '.env'),
      [
        '# comentário',
        'OPENAI_API_KEY=sk-do-arquivo',
        'export ANTHROPIC_API_KEY="sk-ant"',
        "GEMINI_API_KEY='g-key'",
        'CODEANCHOR_API_KEY=nao-deve-sobrescrever',
        'linha-invalida',
        '',
      ].join('\n'),
      'utf8',
    );

    const env: NodeJS.ProcessEnv = { CODEANCHOR_API_KEY: 'ja-definida' };
    const result = loadProjectEnv(projectRoot, env);

    expect(result.loaded).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']);
    expect(env.OPENAI_API_KEY).toBe('sk-do-arquivo');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant');
    expect(env.GEMINI_API_KEY).toBe('g-key');
    expect(env.CODEANCHOR_API_KEY).toBe('ja-definida');
  });

  it('devolve vazio quando o arquivo não existe', () => {
    const projectRoot = makeProject();
    const env: NodeJS.ProcessEnv = {};

    expect(loadProjectEnv(projectRoot, env)).toEqual({ file: null, loaded: [] });
    expect(env).toEqual({});
  });

  it('parseEnvLine aceita export, aspas e ignora comentários', () => {
    expect(parseEnvLine('export A="1"')).toEqual({ key: 'A', value: '1' });
    expect(parseEnvLine("B='2'")).toEqual({ key: 'B', value: '2' });
    expect(parseEnvLine('C=3')).toEqual({ key: 'C', value: '3' });
    expect(parseEnvLine('# C=3')).toBeNull();
    expect(parseEnvLine('sem-igual')).toBeNull();
  });
});
