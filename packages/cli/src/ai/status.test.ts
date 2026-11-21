import { describe, expect, it, vi } from 'vitest';
import { AiStatusTracker } from './status.js';
import type { LLMProvider } from './providers/types.js';

describe('AiStatusTracker', () => {
  it('guarda o último healthCheck e nunca expõe chave', async () => {
    const check = vi.fn(async () => true);
    const provider: LLMProvider = {
      name: 'openai',
      complete: async () => 'ok',
      healthCheck: check,
    };
    const tracker = new AiStatusTracker('openai', provider, 'gpt-4o-mini', true);

    expect(tracker.snapshot()).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keyPresent: true,
      lastHealthCheck: null,
    });

    const result = await tracker.refresh();

    expect(result.ok).toBe(true);
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
    expect(tracker.snapshot().lastHealthCheck?.ok).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tracker.snapshot())).not.toContain('sk-');
  });

  it('healthCheck com erro não lança e marca ok=false', async () => {
    const provider: LLMProvider = {
      name: 'ollama',
      complete: async () => 'ok',
      healthCheck: async () => {
        throw new Error('offline');
      },
    };
    const tracker = new AiStatusTracker('ollama', provider, 'llama3.2', true);

    await expect(tracker.refresh()).resolves.toMatchObject({ ok: false });
  });
});
