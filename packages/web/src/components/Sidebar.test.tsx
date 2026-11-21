import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { MockEventSource } from '../test/MockEventSource';
import { bindingSummaryFixture } from '../test/fixtures';
import { jsonResponse, renderWithProviders } from '../test/render';

describe('Sidebar', () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ...bindingSummaryFixture, red: 3 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.reset();
  });

  it('mostra o badge com a contagem de amarrações 🔴', async () => {
    renderWithProviders(<Sidebar />);

    expect(await screen.findByLabelText('3 amarração(ões) vermelha(s)')).toHaveTextContent('3');
    expect(screen.getByText('Amarrações')).toBeInTheDocument();
  });
});
