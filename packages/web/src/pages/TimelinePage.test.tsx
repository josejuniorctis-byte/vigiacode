import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelinePage } from './TimelinePage';
import { MockEventSource } from '../test/MockEventSource';
import {
  aiStatusFixture,
  batchEvents,
  bindingScanFixture,
  eventFixture,
  projectFixture,
  snapshotsFixture,
} from '../test/fixtures';
import { jsonResponse, renderWithProviders } from '../test/render';

const DIFF = [
  'diff --git a/src/api/users.ts b/src/api/users.ts',
  '--- a/src/api/users.ts',
  '+++ b/src/api/users.ts',
  '@@ -1,2 +1,2 @@',
  '-const alterada = 0;',
  '+const alterada = 1;',
  ' const mantida = true;',
].join('\n');

function installFetchMock(events = batchEvents()) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);

    if (url === '/api/project') return jsonResponse(projectFixture);
    if (url === '/api/health') return jsonResponse({ status: 'ok', version: '0.1.0' });
    if (url === '/api/ai/status') return jsonResponse(aiStatusFixture);
    if (url === '/api/snapshots') return jsonResponse({ snapshots: snapshotsFixture });
    if (url === '/api/bindings/scans?limit=50') {
      return jsonResponse({
        scans: [{ ...bindingScanFixture, batchId: 'b1', createdCount: 2, resolvedCount: 1 }],
      });
    }
    if (url.startsWith('/api/roadmap')) {
      return jsonResponse({
        items: [],
        counts: { todo: 0, doing: 0, done: 0, blocked: 0 },
        next: [],
      });
    }
    if (url === '/api/stats') {
      return jsonResponse({
        totalEvents: events.length,
        totalBatches: 2,
        totalFiles: 3,
        byDay: [],
        byLayer: [],
        topFiles: [],
      });
    }

    if (url.startsWith('/api/events/')) {
      const id = decodeURIComponent(url.slice('/api/events/'.length));
      const event = events.find((item) => item.id === id) ?? events[0]!;
      return jsonResponse({ ...event, diff: DIFF, diffTruncated: true });
    }

    if (url.startsWith('/api/events?')) {
      const parsed = new URL(url, 'http://localhost');
      const layer = parsed.searchParams.get('layer');
      const search = parsed.searchParams.get('q')?.toLowerCase();
      const filtered = events.filter((event) => {
        if (layer && event.layer !== layer) return false;
        if (search && !`${event.filePath} ${event.summary ?? ''}`.toLowerCase().includes(search)) {
          return false;
        }
        return true;
      });
      return jsonResponse({ events: filtered });
    }

    return jsonResponse({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('TimelinePage', () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.reset();
  });

  it('renderiza lotes, atualiza por SSE e preenche o resumo', async () => {
    installFetchMock();
    renderWithProviders(<TimelinePage />);

    expect(await screen.findByText('Ajustou a API de usuários.')).toBeInTheDocument();
    expect(screen.getAllByTestId('batch-card')).toHaveLength(2);
    expect(screen.getByText(/gerando resumo…/)).toBeInTheDocument();
    expect(await screen.findByTestId('batch-bindings')).toHaveTextContent('+2 nova(s)');

    const source = MockEventSource.latest();
    act(() => {
      source.open();
      source.emit('change', {
        type: 'change',
        event: eventFixture({
          id: 'novo',
          batchId: 'b3',
          filePath: 'src/novo.ts',
          layer: 'backend',
          summary: null,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    expect(await screen.findByText('src/novo.ts')).toBeInTheDocument();
    expect(screen.getAllByTestId('batch-card')).toHaveLength(3);

    act(() => {
      source.emit('summary', {
        type: 'summary',
        event: eventFixture({
          id: 'novo',
          batchId: 'b3',
          filePath: 'src/novo.ts',
          layer: 'backend',
          summary: 'Resumo chegou pelo SSE.',
          createdAt: new Date().toISOString(),
        }),
      });
    });

    expect(await screen.findByText('Resumo chegou pelo SSE.')).toBeInTheDocument();
  });

  it('filtra por camada e busca', async () => {
    const fetchMock = installFetchMock();
    renderWithProviders(<TimelinePage />);
    await screen.findByText('Ajustou a API de usuários.');

    fireEvent.change(screen.getByLabelText('Filtrar por camada'), {
      target: { value: 'frontend' },
    });

    await waitFor(() => {
      const called = fetchMock.mock.calls.some(([input]) =>
        String(input).includes('layer=frontend'),
      );
      expect(called).toBe(true);
    });

    await waitFor(() => {
      expect(screen.queryByText('src/api/users.ts')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('src/components/Button.tsx')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Buscar por caminho ou resumo'), {
      target: { value: 'button' },
    });

    await waitFor(
      () => {
        const called = fetchMock.mock.calls.some(([input]) => String(input).includes('q=button'));
        expect(called).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('abre o painel de diff com cores e aviso de truncagem', async () => {
    installFetchMock();
    renderWithProviders(<TimelinePage />);
    await screen.findByText('Ajustou a API de usuários.');

    const cards = screen.getAllByRole('button', { name: /Ver diffs do lote/ });
    fireEvent.click(cards[0]!);

    expect(await screen.findByRole('dialog', { name: 'Detalhes do lote' })).toBeInTheDocument();
    expect(await screen.findByText('const alterada = 1;')).toBeInTheDocument();
    expect(screen.getAllByTestId('diff-add').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('diff-del').length).toBeGreaterThan(0);
    expect(screen.getByText(/Diff truncado pelo VigiaCode/)).toBeInTheDocument();
  });
});
