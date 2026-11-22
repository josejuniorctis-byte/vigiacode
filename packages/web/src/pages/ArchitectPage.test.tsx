import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchitectPage } from './ArchitectPage';
import { MockEventSource } from '../test/MockEventSource';
import { roadmapItemFixture } from '../test/fixtures';
import { jsonResponse, renderWithProviders } from '../test/render';

function installFetchMock() {
  const item = roadmapItemFixture();
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/roadmap' || url.startsWith('/api/roadmap?')) {
      return jsonResponse({
        items: [item],
        counts: { todo: 1, doing: 0, done: 0, blocked: 0 },
        next: [item],
      });
    }
    if (url === '/api/roadmap/r1' && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ ...item, ...body });
    }
    if (url === '/api/architect/plan' && init?.method === 'POST') {
      return jsonResponse({
        provider: 'none',
        heuristic: true,
        objective: 'ligar a tela de pedidos',
        items: [{ ...item, id: 'r2', title: 'Amarar pedidos no DTO' }],
      });
    }
    if (url === '/api/roadmap/generate' && init?.method === 'POST') {
      return jsonResponse({ created: 1, reopened: 0, closed: 0 });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ArchitectPage', () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.reset();
  });

  it('mostra o kanban e move um item de status', async () => {
    const fetchMock = installFetchMock();
    renderWithProviders(<ArchitectPage />);

    expect(await screen.findByText('Ligar o campo phone de user')).toBeInTheDocument();
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(4);
    expect(screen.getByText('src/pages/UsersPage.tsx:12')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status de Ligar o campo phone de user'), {
      target: { value: 'doing' },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input) === '/api/roadmap/r1' && init?.method === 'PATCH',
        ),
      ).toBe(true);
    });
  });

  it('gera plano com IA a partir de um objetivo', async () => {
    installFetchMock();
    renderWithProviders(<ArchitectPage />);
    await screen.findByText('Ligar o campo phone de user');

    fireEvent.change(screen.getByLabelText('Objetivo do plano'), {
      target: { value: 'ligar a tela de pedidos' },
    });
    fireEvent.click(screen.getByTestId('architect-plan-button'));

    expect(await screen.findByTestId('plan-result')).toHaveTextContent('heurística local');
  });
});
