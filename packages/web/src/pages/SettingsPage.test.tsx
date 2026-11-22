import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { aiStatusFixture } from '../test/fixtures';
import { jsonResponse, renderWithProviders } from '../test/render';
import type { AppConfig } from '../types';

const config: AppConfig = {
  project: { name: 'projeto-teste', rootPath: '/tmp/projeto-teste' },
  watch: { paths: ['.'], ignore: ['node_modules'], debounceMs: 1500, maxFileSizeKb: 500 },
  git: { maxDiffKb: 200 },
  llm: {
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434',
    timeoutMs: 15000,
    maxTokens: 512,
    temperature: 0.2,
    fallbackProviders: ['none'],
  },
  server: { host: 'localhost', port: 4317 },
  database: { dialect: 'sqlite', file: 'vigiacode.db' },
};

describe('SettingsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra config/IA e testa o provider sem exibir chave', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/config') return jsonResponse(config);
      if (url === '/api/ai/status') return jsonResponse(aiStatusFixture);
      if (url === '/api/ai/test' && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          provider: 'ollama',
          model: 'llama3.2',
          elapsedMs: 42,
          response: 'Resposta de teste.',
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText('projeto-teste')).toBeInTheDocument();
    expect(screen.getByText('ollama')).toBeInTheDocument();
    expect(screen.getByText('sem chave necessária')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Testar IA' }));

    await waitFor(() => expect(screen.getByText('Resposta de teste.')).toBeInTheDocument());
    expect(screen.queryByText(/sua-chave|sk-/i)).not.toBeInTheDocument();
  });
});
