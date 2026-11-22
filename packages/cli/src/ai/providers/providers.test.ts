import { describe, expect, it } from 'vitest';
import type { LlmConfig, LlmProvider } from '../../config.js';
import {
  createProvider,
  MissingApiKeyError,
  ProviderConfigError,
  ProviderHttpError,
  ProviderTimeoutError,
  describeProviderError,
} from '../index.js';

function llm(provider: LlmProvider, overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider,
    model: null,
    baseUrl: null,
    timeoutMs: 1000,
    maxTokens: 100,
    temperature: 0.2,
    fallbackProviders: [],
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockJson(body: unknown, status = 200): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function header(call: FetchCall, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe('OpenAI provider', () => {
  it('monta URL, headers e corpo e faz parsing da resposta', async () => {
    const { fetchImpl, calls } = mockJson({
      choices: [{ message: { role: 'assistant', content: 'Resposta OpenAI' } }],
    });
    const provider = createProvider(llm('openai'), {
      fetchImpl,
      env: { OPENAI_API_KEY: 'sk-openai' },
    });

    const text = await provider.complete('Explique', { system: 'Sistema' });

    expect(text).toBe('Resposta OpenAI');
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]?.init.method).toBe('POST');
    expect(header(calls[0]!, 'authorization')).toBe('Bearer sk-openai');
    const body = bodyOf(calls[0]!);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Sistema' },
      { role: 'user', content: 'Explique' },
    ]);
  });

  it('usa VIGIACODE_API_KEY como fallback da chave', async () => {
    const { fetchImpl, calls } = mockJson({
      choices: [{ message: { content: 'ok' } }],
    });
    const provider = createProvider(llm('openai'), {
      fetchImpl,
      env: { VIGIACODE_API_KEY: 'sk-generica' },
    });

    await provider.complete('oi');

    expect(header(calls[0]!, 'authorization')).toBe('Bearer sk-generica');
  });

  it('aceita CODEANCHOR_API_KEY como alias legado e prioriza VIGIACODE_API_KEY', async () => {
    const legacy = mockJson({ choices: [{ message: { content: 'ok' } }] });
    const legacyProvider = createProvider(llm('openai'), {
      fetchImpl: legacy.fetchImpl,
      env: { CODEANCHOR_API_KEY: 'sk-legado' },
    });
    await legacyProvider.complete('oi');
    expect(header(legacy.calls[0]!, 'authorization')).toBe('Bearer sk-legado');

    const both = mockJson({ choices: [{ message: { content: 'ok' } }] });
    const bothProvider = createProvider(llm('openai'), {
      fetchImpl: both.fetchImpl,
      env: { VIGIACODE_API_KEY: 'sk-novo', CODEANCHOR_API_KEY: 'sk-legado' },
    });
    await bothProvider.complete('oi');
    expect(header(both.calls[0]!, 'authorization')).toBe('Bearer sk-novo');
  });

  it('healthCheck consulta /models e retorna false em erro', async () => {
    const healthy = mockJson({ data: [] });
    const provider = createProvider(llm('openai'), {
      fetchImpl: healthy.fetchImpl,
      env: { OPENAI_API_KEY: 'sk' },
    });
    await expect(provider.healthCheck()).resolves.toBe(true);
    expect(healthy.calls[0]?.url).toBe('https://api.openai.com/v1/models');

    const unhealthy = mockJson({ error: 'unauthorized' }, 401);
    const failing = createProvider(llm('openai'), {
      fetchImpl: unhealthy.fetchImpl,
      env: { OPENAI_API_KEY: 'sk' },
    });
    await expect(failing.healthCheck()).resolves.toBe(false);
  });
});

describe('OpenAI-compatible provider', () => {
  it('exige base_url e modelo', () => {
    expect(() => createProvider(llm('openai-compatible'))).toThrow(ProviderConfigError);
    expect(() =>
      createProvider(llm('openai-compatible', { baseUrl: 'https://openrouter.ai/api/v1' })),
    ).toThrow(/modelo/);
  });

  it('usa a base_url configurada e a chave genérica', async () => {
    const { fetchImpl, calls } = mockJson({
      choices: [{ message: { content: 'OpenRouter ok' } }],
    });
    const provider = createProvider(
      llm('openai-compatible', {
        model: 'meta/llama',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
      { fetchImpl, env: { VIGIACODE_API_KEY: 'sk-or' } },
    );

    await provider.complete('oi');

    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(header(calls[0]!, 'authorization')).toBe('Bearer sk-or');
    expect(bodyOf(calls[0]!).model).toBe('meta/llama');
  });
});

describe('Anthropic provider', () => {
  it('usa headers e corpo específicos e faz parsing do content', async () => {
    const { fetchImpl, calls } = mockJson({
      content: [
        { type: 'text', text: 'Claude ok' },
        { type: 'tool_use', id: 'x' },
      ],
    });
    const provider = createProvider(llm('anthropic'), {
      fetchImpl,
      env: { ANTHROPIC_API_KEY: 'sk-ant' },
    });

    const text = await provider.complete('Explique', { system: 'Sistema' });

    expect(text).toBe('Claude ok');
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(header(calls[0]!, 'x-api-key')).toBe('sk-ant');
    expect(header(calls[0]!, 'anthropic-version')).toBe('2023-06-01');
    const body = bodyOf(calls[0]!);
    expect(body.max_tokens).toBe(100);
    expect(body.system).toBe('Sistema');
    expect(body.model).toBe('claude-3-5-haiku-latest');
  });

  it('não duplica /v1 quando o base_url já termina em /v1', async () => {
    const { fetchImpl, calls } = mockJson({ content: [{ type: 'text', text: 'ok' }] });
    const provider = createProvider(llm('anthropic', { baseUrl: 'https://api.anthropic.com/v1' }), {
      fetchImpl,
      env: { ANTHROPIC_API_KEY: 'sk' },
    });

    await provider.complete('oi');

    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('Gemini provider', () => {
  it('monta a URL com modelo, header e generationConfig', async () => {
    const { fetchImpl, calls } = mockJson({
      candidates: [{ content: { parts: [{ text: 'Gemini ok' }] } }],
    });
    const provider = createProvider(llm('gemini'), {
      fetchImpl,
      env: { GOOGLE_API_KEY: 'g-key' },
    });

    const text = await provider.complete('Explique');

    expect(text).toBe('Gemini ok');
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    );
    expect(header(calls[0]!, 'x-goog-api-key')).toBe('g-key');
    const body = bodyOf(calls[0]!);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Explique' }] }]);
    expect(body.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 100 });
  });
});

describe('Ollama provider', () => {
  it('chama /api/chat sem header de autenticação', async () => {
    const { fetchImpl, calls } = mockJson({ message: { content: 'Ollama ok' } });
    const provider = createProvider(llm('ollama'), { fetchImpl, env: {} });

    const text = await provider.complete('Explique', { system: 'Sistema' });

    expect(text).toBe('Ollama ok');
    expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
    expect(header(calls[0]!, 'authorization')).toBeNull();
    const body = bodyOf(calls[0]!);
    expect(body.options).toEqual({ temperature: 0.2, num_predict: 100 });
  });

  it('healthCheck consulta /api/tags', async () => {
    const { fetchImpl, calls } = mockJson({ models: [] });
    const provider = createProvider(llm('ollama'), { fetchImpl });

    await expect(provider.healthCheck()).resolves.toBe(true);
    expect(calls[0]?.url).toBe('http://localhost:11434/api/tags');
  });
});

describe('erros de provider', () => {
  it.each([
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['gemini', 'GEMINI_API_KEY'],
  ] as const)('chave ausente para %s lista %s', async (providerName, variable) => {
    const provider = createProvider(llm(providerName), {
      fetchImpl: mockJson({}).fetchImpl,
      env: {},
    });

    let error: unknown;
    try {
      await provider.complete('oi');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MissingApiKeyError);
    const message = describeProviderError(error, providerName);
    expect(message).toContain(variable);
    expect(message).toContain('Bash:');
    expect(message).toContain('PowerShell:');
  });

  it('chave ausente para openai-compatible usa VIGIACODE_API_KEY', async () => {
    const provider = createProvider(
      llm('openai-compatible', {
        model: 'modelo',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
      { fetchImpl: mockJson({}).fetchImpl, env: {} },
    );

    await expect(provider.complete('oi')).rejects.toThrow(/VIGIACODE_API_KEY/);
  });

  it('chave ausente explica as variáveis e exemplos sem expor segredo', async () => {
    const provider = createProvider(llm('openai'), { fetchImpl: mockJson({}).fetchImpl, env: {} });

    let error: unknown;
    try {
      await provider.complete('oi');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MissingApiKeyError);
    const message = describeProviderError(error, 'openai');
    expect(message).toContain('OPENAI_API_KEY');
    expect(message).toContain('VIGIACODE_API_KEY');
    expect(message).toContain('Bash:');
    expect(message).toContain('PowerShell:');
    expect(message).toContain('.vigiacode/.env');
  });

  it('HTTP 401 vira mensagem clara de autenticação', async () => {
    const { fetchImpl } = mockJson({ error: 'unauthorized' }, 401);
    const provider = createProvider(llm('openai'), {
      fetchImpl,
      env: { OPENAI_API_KEY: 'sk-secret' },
    });

    let error: unknown;
    try {
      await provider.complete('oi');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProviderHttpError);
    const message = describeProviderError(error, 'openai');
    expect(message).toContain('401');
    expect(message).toContain('OPENAI_API_KEY');
    expect(message).not.toContain('sk-secret');
  });

  it('timeout vira ProviderTimeoutError', async () => {
    const fetchImpl = (async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }) as typeof fetch;
    const provider = createProvider(llm('ollama'), { fetchImpl });

    let error: unknown;
    try {
      await provider.complete('oi');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProviderTimeoutError);
    expect(describeProviderError(error, 'ollama')).toContain('Tempo esgotado');
  });

  it('Ollama offline sugere ollama serve', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const provider = createProvider(llm('ollama'), { fetchImpl });

    let error: unknown;
    try {
      await provider.complete('oi');
    } catch (caught) {
      error = caught;
    }

    expect(describeProviderError(error, 'ollama')).toContain('ollama serve');
  });
});
