import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmConfig } from '../config.js';
import { buildSummaryPrompt } from './prompt.js';
import { createSummarizer, HeuristicSummarizer } from './summarizer.js';
import type { SummaryInput } from './types.js';

const input: SummaryInput = {
  projectName: 'demo',
  changes: [
    {
      filePath: 'src/api/users.ts',
      changeType: 'change',
      layer: 'backend',
      diff: ['-const a = 1;', '+const a = 2;', '+const b = 3;'].join('\n'),
    },
  ],
};

function ollamaConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434',
    timeoutMs: 1000,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.CODEANCHOR_API_KEY;
});

describe('sumário heurístico', () => {
  it('descreve arquivos, camada e contagem de linhas', async () => {
    const summary = await new HeuristicSummarizer().summarize(input);

    expect(summary).toContain('1 arquivo alterado');
    expect(summary).toContain('src/api/users.ts');
    expect(summary).toContain('+2');
    expect(summary).toContain('−1');
    expect(summary).toContain('Camada: backend');
    expect(summary).toContain('Impacto provável');
  });

  it('resume lotes com múltiplas camadas', async () => {
    const summary = await new HeuristicSummarizer().summarize({
      projectName: 'demo',
      changes: [
        input.changes[0]!,
        {
          filePath: 'src/components/Button.tsx',
          changeType: 'add',
          layer: 'frontend',
          diff: '+export const Button = () => null;',
        },
      ],
    });

    expect(summary).toContain('2 arquivos alterados');
    expect(summary).toContain('frontend, backend');
    expect(summary).toContain('em src:');
  });

  it('o provider none não faz chamadas de rede', async () => {
    const fetchImpl = vi.fn();
    const summarizer = createSummarizer(
      { provider: 'none', model: null, baseUrl: null, timeoutMs: 1000 },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const summary = await summarizer.summarize(input);

    expect(summary).toContain('1 arquivo alterado');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('resumos com IA', () => {
  it('usa o Ollama e devolve o conteúdo em português', async () => {
    let calledUrl = '';
    const fetchImpl = (async (url: string | URL | Request) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ message: { role: 'assistant', content: 'Resumo do Ollama.' } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const summarizer = createSummarizer(ollamaConfig(), { fetchImpl });
    const summary = await summarizer.summarize(input);

    expect(calledUrl).toBe('http://localhost:11434/api/chat');
    expect(summary).toBe('Resumo do Ollama.');
  });

  it('faz fallback para o heurístico quando a IA falha', async () => {
    const warnings: string[] = [];
    const fetchImpl = (async () => {
      throw new Error('ollama offline');
    }) as typeof fetch;

    const summarizer = createSummarizer(ollamaConfig(), {
      fetchImpl,
      logger: { warn: (message) => warnings.push(message) },
    });

    const summary = await summarizer.summarize(input);

    expect(summary).toContain('1 arquivo alterado');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((message) => message.includes('heurístico'))).toBe(true);
  });

  it('OpenAI envia a chave do env e não a grava no resumo', async () => {
    let authorization = '';
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      authorization = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? '',
      );
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Resumo OpenAI.' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const summarizer = createSummarizer(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        timeoutMs: 1000,
      },
      { fetchImpl, env: { CODEANCHOR_API_KEY: 'sk-teste' } },
    );

    const summary = await summarizer.summarize(input);

    expect(summary).toBe('Resumo OpenAI.');
    expect(authorization).toBe('Bearer sk-teste');
  });

  it('openai sem chave cai no heurístico', async () => {
    const warnings: string[] = [];
    const summarizer = createSummarizer(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        timeoutMs: 1000,
      },
      {
        env: {},
        logger: { warn: (message) => warnings.push(message) },
      },
    );

    const summary = await summarizer.summarize(input);

    expect(summary).toContain('1 arquivo alterado');
    expect(warnings.some((message) => message.includes('CODEANCHOR_API_KEY'))).toBe(true);
    expect(warnings.some((message) => message.includes('OPENAI_API_KEY'))).toBe(true);
  });

  it('usa fallbackProviders quando o principal falha', async () => {
    const warnings: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes('openai.com')) {
        return new Response(JSON.stringify({ error: 'indisponível' }), { status: 500 });
      }
      if (target.includes('11434')) {
        return new Response(
          JSON.stringify({ message: { content: 'Resumo do fallback Ollama.' } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const summarizer = createSummarizer(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        timeoutMs: 1000,
        fallbackProviders: ['ollama'],
      },
      {
        fetchImpl,
        env: { OPENAI_API_KEY: 'sk-teste' },
        logger: { warn: (message) => warnings.push(message) },
      },
    );

    const summary = await summarizer.summarize(input);

    expect(summary).toBe('Resumo do fallback Ollama.');
    expect(warnings.some((message) => message.includes('openai'))).toBe(true);
    expect(warnings.some((message) => message.includes('heurístico'))).toBe(false);
  });
});

describe('prompt', () => {
  it('pede resumo em português com camada e impacto', () => {
    const prompt = buildSummaryPrompt(input);

    expect(prompt).toContain('português');
    expect(prompt).toContain('src/api/users.ts');
    expect(prompt).toContain('backend');
    expect(prompt).toContain('impacto');
  });
});
