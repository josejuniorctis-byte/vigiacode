import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../config.js';
import { runAiTest, runAiUse } from './ai.js';
import { runInit } from './init.js';

const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vigiacode-ai-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('vigiacode ai', () => {
  it('ai use troca provider/modelo e grava o config', async () => {
    const projectRoot = makeProject();
    await runInit({ cwd: projectRoot, yes: true });

    await runAiUse({ cwd: projectRoot, provider: 'ollama', model: 'llama3.2' });

    const config = readConfig(projectRoot);
    expect(config.llm.provider).toBe('ollama');
    expect(config.llm.model).toBe('llama3.2');
    expect(config.llm.baseUrl).toBe('http://localhost:11434');
  });

  it('ai use openai-compatible exige base_url e modelo', async () => {
    const projectRoot = makeProject();
    await runInit({ cwd: projectRoot, yes: true });
    const before = readConfig(projectRoot);
    const previousExit = process.exitCode;
    process.exitCode = 0;

    try {
      await runAiUse({
        cwd: projectRoot,
        provider: 'openai-compatible',
        model: 'meta/llama',
      });

      expect(process.exitCode).toBe(1);
      expect(readConfig(projectRoot)).toEqual(before);
    } finally {
      process.exitCode = previousExit;
    }
  });

  it('ai use openai-compatible com base_url e modelo funciona', async () => {
    const projectRoot = makeProject();
    await runInit({ cwd: projectRoot, yes: true });

    await runAiUse({
      cwd: projectRoot,
      provider: 'openai-compatible',
      model: 'meta/llama',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    const config = readConfig(projectRoot);
    expect(config.llm.provider).toBe('openai-compatible');
    expect(config.llm.model).toBe('meta/llama');
    expect(config.llm.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('ai test com provider none não tenta IA', async () => {
    const projectRoot = makeProject();
    await runInit({ cwd: projectRoot, yes: true });
    const previousExit = process.exitCode;
    process.exitCode = 0;

    try {
      await runAiTest({ cwd: projectRoot });
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = previousExit;
    }
  });
});
