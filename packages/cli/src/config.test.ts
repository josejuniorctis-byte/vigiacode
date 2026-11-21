import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig, readConfig } from './config.js';

const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeanchor-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('config', () => {
  it('lê config da Etapa 1 e preenche os campos novos com padrões', () => {
    const projectRoot = makeProject();
    mkdirSync(path.join(projectRoot, '.codeanchor'), { recursive: true });
    writeFileSync(
      path.join(projectRoot, '.codeanchor', 'config.json'),
      JSON.stringify({
        version: 1,
        project: { name: 'legado', rootPath: projectRoot },
        watch: { paths: ['src'], ignore: ['node_modules'] },
        llm: { provider: 'byok' },
        server: { host: 'localhost', port: 4400 },
        database: { dialect: 'sqlite', file: 'codeanchor.db' },
      }),
      'utf8',
    );

    const config = readConfig(projectRoot);

    expect(config.watch.paths).toEqual(['src']);
    expect(config.watch.ignore).toEqual(['node_modules']);
    expect(config.watch.debounceMs).toBe(1500);
    expect(config.watch.maxFileSizeKb).toBe(500);
    expect(config.git.maxDiffKb).toBe(200);
    expect(config.llm.provider).toBe('byok');
    expect(config.llm.model).toBe('gpt-4o-mini');
    expect(config.llm.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.llm.timeoutMs).toBe(15_000);
  });

  it('aplica padrões por provider', () => {
    const ollama = createDefaultConfig({
      name: 'demo',
      rootPath: 'C:/demo',
      provider: 'ollama',
    });
    expect(ollama.llm.model).toBe('llama3.2');
    expect(ollama.llm.baseUrl).toBe('http://localhost:11434');
    expect(ollama.watch.paths).toEqual(['.']);

    const byok = createDefaultConfig({
      name: 'demo',
      rootPath: 'C:/demo',
      provider: 'byok',
      model: 'meu-modelo',
      baseUrl: 'https://api.exemplo.com/v1',
    });
    expect(byok.llm.model).toBe('meu-modelo');
    expect(byok.llm.baseUrl).toBe('https://api.exemplo.com/v1');
  });
});
