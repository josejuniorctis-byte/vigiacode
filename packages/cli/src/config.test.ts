import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig, readConfig, writeConfig } from './config.js';

const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeanchor-config-'));
  tempDirs.push(dir);
  return dir;
}

function writeRawConfig(projectRoot: string, config: Record<string, unknown>): void {
  mkdirSync(path.join(projectRoot, '.codeanchor'), { recursive: true });
  writeFileSync(
    path.join(projectRoot, '.codeanchor', 'config.json'),
    JSON.stringify(config),
    'utf8',
  );
}

function legacyConfig(projectRoot: string, llm: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    project: { name: 'legado', rootPath: projectRoot },
    watch: { paths: ['src'], ignore: ['node_modules'] },
    llm,
    server: { host: 'localhost', port: 4400 },
    database: { dialect: 'sqlite', file: 'codeanchor.db' },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('config', () => {
  it('lê config da Etapa 1 e migra "byok" para openai', () => {
    const projectRoot = makeProject();
    writeRawConfig(projectRoot, legacyConfig(projectRoot, { provider: 'byok' }));

    const config = readConfig(projectRoot);

    expect(config.watch.paths).toEqual(['src']);
    expect(config.watch.ignore).toEqual(['node_modules']);
    expect(config.watch.debounceMs).toBe(1500);
    expect(config.watch.maxFileSizeKb).toBe(500);
    expect(config.git.maxDiffKb).toBe(200);
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.model).toBe('gpt-4o-mini');
    expect(config.llm.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.llm.timeoutMs).toBe(15_000);
    expect(config.llm.maxTokens).toBe(512);
    expect(config.llm.temperature).toBe(0.2);
    expect(config.llm.fallbackProviders).toEqual([]);
  });

  it('migra "byok" com base_url não-OpenAI para openai-compatible', () => {
    const projectRoot = makeProject();
    writeRawConfig(
      projectRoot,
      legacyConfig(projectRoot, {
        provider: 'byok',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openrouter/modelo',
      }),
    );

    const config = readConfig(projectRoot);

    expect(config.llm.provider).toBe('openai-compatible');
    expect(config.llm.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.llm.model).toBe('openrouter/modelo');
  });

  it('aceita campos novos em snake_case e fallback_providers', () => {
    const projectRoot = makeProject();
    writeRawConfig(
      projectRoot,
      legacyConfig(projectRoot, {
        provider: 'anthropic',
        model: 'claude-3-5-haiku-latest',
        base_url: 'https://api.anthropic.com',
        timeout: 20_000,
        max_tokens: 256,
        temperature: 0.7,
        fallback_providers: ['ollama', 'none', 'ollama'],
      }),
    );

    const config = readConfig(projectRoot);

    expect(config.llm.timeoutMs).toBe(20_000);
    expect(config.llm.maxTokens).toBe(256);
    expect(config.llm.temperature).toBe(0.7);
    expect(config.llm.fallbackProviders).toEqual(['ollama', 'none']);
  });

  it('grava os campos de IA em snake_case', () => {
    const projectRoot = makeProject();
    const config = createDefaultConfig({
      name: 'demo',
      rootPath: projectRoot,
      provider: 'gemini',
      maxTokens: 300,
      temperature: 0.1,
      fallbackProviders: ['ollama'],
    });
    writeConfig(projectRoot, config);

    const raw = JSON.parse(
      readFileSync(path.join(projectRoot, '.codeanchor', 'config.json'), 'utf8'),
    ) as { llm: Record<string, unknown> };

    expect(raw.llm).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      base_url: 'https://generativelanguage.googleapis.com',
      timeout: 15_000,
      max_tokens: 300,
      temperature: 0.1,
      fallback_providers: ['ollama'],
    });
    expect(readConfig(projectRoot).llm.provider).toBe('gemini');
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

    const openai = createDefaultConfig({
      name: 'demo',
      rootPath: 'C:/demo',
      provider: 'openai',
      model: 'meu-modelo',
      baseUrl: 'https://api.exemplo.com/v1',
    });
    expect(openai.llm.model).toBe('meu-modelo');
    expect(openai.llm.baseUrl).toBe('https://api.exemplo.com/v1');

    const compatible = createDefaultConfig({
      name: 'demo',
      rootPath: 'C:/demo',
      provider: 'openai-compatible',
    });
    expect(compatible.llm.model).toBeNull();
    expect(compatible.llm.baseUrl).toBeNull();
  });

  it('mantém compatibilidade com campos camelCase da Etapa 2', () => {
    const projectRoot = makeProject();
    writeRawConfig(
      projectRoot,
      legacyConfig(projectRoot, {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        timeoutMs: 9000,
        maxTokens: 128,
      }),
    );

    const config = readConfig(projectRoot);
    expect(config.llm.timeoutMs).toBe(9000);
    expect(config.llm.maxTokens).toBe(128);
  });
});
