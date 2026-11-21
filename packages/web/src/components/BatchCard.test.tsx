import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BatchCard } from './BatchCard';
import { groupEvents } from '../utils/batches';
import { batchEvents } from '../test/fixtures';

describe('BatchCard', () => {
  it('mostra resumo, camadas e contadores e abre o lote', () => {
    const batch = groupEvents(batchEvents()).find((item) => !item.summaryPending);
    const onOpen = vi.fn();

    render(<BatchCard batch={batch!} onOpen={onOpen} />);

    expect(screen.getByText('Ajustou a API de usuários.')).toBeInTheDocument();
    expect(screen.getByText('backend')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('2 arquivos')).toBeInTheDocument();
    expect(screen.getByText('+6')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ver diffs do lote/ }));
    expect(onOpen).toHaveBeenCalledWith(batch);
  });

  it('mostra amarrações criadas e resolvidas no lote', () => {
    const batch = groupEvents(batchEvents())[0]!;
    render(
      <BatchCard
        batch={batch}
        bindingDelta={{ created: 2, resolved: 1 }}
        onOpen={() => undefined}
      />,
    );

    const strip = screen.getByTestId('batch-bindings');
    expect(strip).toHaveTextContent('+2 nova(s)');
    expect(strip).toHaveTextContent('1 resolvida(s)');
  });

  it('mostra skeleton de resumo pendente', () => {
    const batches = groupEvents(batchEvents());
    const pending = batches.find((batch) => batch.summaryPending);

    render(<BatchCard batch={pending!} onOpen={() => undefined} />);

    expect(screen.getByLabelText('gerando resumo')).toBeInTheDocument();
    expect(screen.getByText(/gerando resumo…/)).toBeInTheDocument();
  });
});
