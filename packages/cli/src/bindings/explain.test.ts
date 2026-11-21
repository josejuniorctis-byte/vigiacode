import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../ai/index.js';
import type { Binding } from '../db/schema.js';
import { explainBinding, explainHeuristic } from './explain.js';

function binding(overrides: Partial<Binding> = {}): Binding {
  return {
    id: 'b1',
    projectId: 'p1',
    layer: 'backend',
    entity: 'user',
    field: 'phone',
    status: 'red',
    ruleId: 'R1',
    severity: 'red',
    message: '[R1] Campo "phone" usado no front-end não existe no DTO/rota de "user".',
    frontRef: 'src/pages/UsersPage.tsx:14',
    backRef: 'server/routes/users.ts:5',
    dbRef: null,
    suggestion: null,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    accepted: false,
    detectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('explicação de amarrações', () => {
  it('gera explicação heurística em português e sugestão de código', () => {
    const result = explainHeuristic(binding());

    expect(result.explanation).toContain('R1');
    expect(result.explanation).toContain('phone');
    expect(result.explanation).toContain('src/pages/UsersPage.tsx:14');
    expect(result.suggestion).toContain('interface UserDto');
    expect(result.suggestion).toContain('ALTER TABLE user ADD COLUMN phone TEXT');
  });

  it('com provider none devolve heuristic: true sem chamar rede', async () => {
    const result = await explainBinding({ binding: binding(), provider: null });
    expect(result).toMatchObject({ provider: 'none', heuristic: true });
    expect(result.explanation.length).toBeGreaterThan(20);
  });

  it('usa o LLMProvider e separa explicação de bloco de código', async () => {
    const provider: LLMProvider = {
      name: 'ollama',
      async complete() {
        return [
          'O formulário usa phone, mas o DTO de usuário não tem esse campo.',
          '',
          '```ts',
          'interface UserDto { phone?: string }',
          '```',
        ].join('\n');
      },
      async healthCheck() {
        return true;
      },
    };

    const result = await explainBinding({ binding: binding(), provider, model: 'llama3.2' });

    expect(result).toMatchObject({ provider: 'ollama', model: 'llama3.2', heuristic: false });
    expect(result.explanation).toContain('O formulário usa phone');
    expect(result.suggestion).toContain('interface UserDto { phone?: string }');
  });

  it('cai na heurística quando a IA falha', async () => {
    const provider: LLMProvider = {
      name: 'openai',
      async complete() {
        throw new Error('timeout');
      },
      async healthCheck() {
        return false;
      },
    };

    const result = await explainBinding({ binding: binding(), provider });
    expect(result).toMatchObject({ provider: 'openai', heuristic: true });
    expect(result.suggestion).toContain('interface UserDto');
  });
});
