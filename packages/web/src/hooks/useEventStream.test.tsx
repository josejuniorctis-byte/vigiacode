import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventStream } from './useEventStream';
import { MockEventSource } from '../test/MockEventSource';
import { eventFixture } from '../test/fixtures';

describe('useEventStream', () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('conecta, recebe change/summary e reconecta com backoff', () => {
    const onEvent = vi.fn();
    const onSummary = vi.fn();
    const onBindings = vi.fn();
    const { result, unmount } = renderHook(() =>
      useEventStream({ onEvent, onSummary, onBindings }),
    );

    expect(result.current).toBe('connecting');
    const first = MockEventSource.latest();
    expect(first.url).toBe('/api/events/stream');

    act(() => first.open());
    expect(result.current).toBe('live');

    act(() => first.emit('change', { type: 'change', event: eventFixture({ id: 'novo' }) }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'novo' }));

    act(() =>
      first.emit('summary', {
        type: 'summary',
        event: eventFixture({ id: 'novo', summary: 'Resumo final' }),
      }),
    );
    expect(onSummary).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Resumo final' }));

    act(() =>
      first.emit('bindings', {
        type: 'bindings',
        scanId: 'scan-1',
        trigger: 'watch',
        batchId: 'b1',
        counts: { red: 1, yellow: 0, green: 2 },
        created: [],
        resolved: [],
        summary: {},
      }),
    );
    expect(onBindings).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bindings', batchId: 'b1' }),
    );

    act(() => first.fail());
    expect(result.current).toBe('offline');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => MockEventSource.latest().open());
    expect(result.current).toBe('live');

    unmount();
    expect(MockEventSource.latest().readyState).toBe(MockEventSource.CLOSED);
  });
});
