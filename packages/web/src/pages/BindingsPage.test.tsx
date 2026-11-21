import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindingsPage } from './BindingsPage';
import { MockEventSource } from '../test/MockEventSource';
import {
  bindingFixture,
  bindingMatrixFixture,
  bindingScanFixture,
  bindingSummaryFixture,
} from '../test/fixtures';
import { jsonResponse, renderWithProviders } from '../test/render';

function installFetchMock() {
  let summary = { ...bindingSummaryFixture };
  const bindings = [
    bindingFixture(),
    bindingFixture({
      id: 'b2',
      ruleId: 'R2',
      layer: 'database',
      entity: 'user',
      field: 'nickname',
      status: 'yellow',
      message: '[R2] Campo "nickname" do DTO não tem coluna em "users".',
    }),
    bindingFixture({
      id: 'b3',
      ruleId: 'GREEN',
      layer: 'backend',
      entity: 'user',
      field: 'name',
      status: 'green',
      message: 'Campo "name" está amarrado entre front-end, back-end e banco.',
    }),
  ];

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === '/api/bindings/summary') return jsonResponse(summary);
    if (url === '/api/bindings/matrix') return jsonResponse(bindingMatrixFixture);
    if (url === '/api/bindings/scans?limit=50') {
      return jsonResponse({ scans: [bindingScanFixture] });
    }
    if (url.endsWith('/explain') && init?.method === 'POST') {
      return jsonResponse({
        bindingId: 'b1',
        provider: 'none',
        model: null,
        heuristic: true,
        explanation: 'O campo phone precisa entrar no DTO de usuário.',
        suggestion: 'interface UserDto { phone?: string }',
      });
    }
    if (url.endsWith('/accept') && init?.method === 'POST') {
      return jsonResponse({ ...bindingFixture(), accepted: true });
    }
    if (url === '/api/bindings/scan' && init?.method === 'POST') {
      return jsonResponse({ skipped: true });
    }
    if (url.startsWith('/api/bindings')) {
      const parsed = new URL(url, 'http://localhost');
      const status = parsed.searchParams.get('status');
      const filtered = status ? bindings.filter((binding) => binding.status === status) : bindings;
      return jsonResponse({ bindings: filtered });
    }

    return jsonResponse({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, setSummary: (next: typeof summary) => (summary = next) };
}

describe('BindingsPage', () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.reset();
  });

  it('mostra cards, matriz, pendências e referências clicáveis', async () => {
    installFetchMock();
    renderWithProviders(<BindingsPage />);

    expect(await screen.findByText('Matriz de amarrações')).toBeInTheDocument();
    expect(await screen.findByText('62%')).toBeInTheDocument();
    expect(screen.getAllByTestId('matrix-row')).toHaveLength(2);
    expect(screen.getByText('⬜')).toBeInTheDocument();

    expect(
      await screen.findByText(
        '[R1] Campo "phone" usado no front-end não existe no DTO/rota de "user".',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('binding-row')).toHaveLength(3);
    expect(screen.getAllByText('src/pages/UsersPage.tsx').length).toBeGreaterThan(0);
  });

  it('filtra por status e camada e busca', async () => {
    const { fetchMock } = installFetchMock();
    renderWithProviders(<BindingsPage />);
    await screen.findByText('Matriz de amarrações');

    fireEvent.change(screen.getByLabelText('Filtrar por status'), {
      target: { value: 'red' },
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('status=red'))).toBe(
        true,
      );
    });

    fireEvent.change(screen.getByLabelText('Filtrar por camada'), {
      target: { value: 'database' },
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('layer=database'))).toBe(
        true,
      );
    });
  });

  it('explica com IA e aceita falso positivo', async () => {
    const { fetchMock } = installFetchMock();
    renderWithProviders(<BindingsPage />);
    await screen.findByText('Matriz de amarrações');

    const explainButtons = await screen.findAllByRole('button', { name: /Explicar com IA/ });
    fireEvent.click(explainButtons[0]!);

    expect(
      await screen.findByText('O campo phone precisa entrar no DTO de usuário.'),
    ).toBeInTheDocument();
    expect(screen.getByText('interface UserDto { phone?: string }')).toBeInTheDocument();

    const acceptButtons = screen.getAllByRole('button', {
      name: 'Aceitar como falso positivo',
    });
    fireEvent.click(acceptButtons[0]!);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/accept'))).toBe(true);
    });
  });

  it('atualiza as contagens em tempo real pelo SSE', async () => {
    const { setSummary } = installFetchMock();
    renderWithProviders(<BindingsPage />);
    await screen.findByText('62%');

    const source = MockEventSource.latest();
    act(() => {
      source.open();
    });

    setSummary({ ...bindingSummaryFixture, red: 0, yellow: 1, green: 7, healthPercent: 88 });
    act(() => {
      source.emit('bindings', {
        type: 'bindings',
        scanId: 'scan-2',
        trigger: 'watch',
        batchId: 'b9',
        counts: { red: 0, yellow: 1, green: 7 },
        created: [],
        resolved: [bindingFixture({ id: 'b1' })],
        summary: bindingSummaryFixture,
      });
    });

    expect(await screen.findByText('88%')).toBeInTheDocument();
    expect(screen.getByText('Atualizado em tempo real pelo vigia')).toBeInTheDocument();
  });
});
