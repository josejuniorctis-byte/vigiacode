import { useMemo } from 'react';
import { useInfiniteEvents } from '../api/hooks';
import { useLiveEvents } from './useLiveEvents';
import type { ChangeEvent, TimelineFilters } from '../types';
import { matchesFilters } from '../utils/batches';

/**
 * Junta as páginas carregadas via API com os eventos recebidos pelo SSE.
 * Eventos ao vivo sobrescrevem os da API (ex.: summary que acabou de chegar).
 */
export function useMergedEvents(filters: TimelineFilters, limit = 100) {
  const query = useInfiniteEvents(filters, limit);
  const { events: liveEvents } = useLiveEvents();

  const fetched = useMemo(
    () => query.data?.pages.flatMap((page) => page.events) ?? [],
    [query.data],
  );

  const events = useMemo(() => {
    const merged = new Map<string, ChangeEvent>();
    for (const event of fetched) merged.set(event.id, event);
    for (const event of Object.values(liveEvents)) merged.set(event.id, event);

    return [...merged.values()]
      .filter((event) => matchesFilters(event, filters))
      .sort((left, right) => {
        const byDate = right.createdAt.localeCompare(left.createdAt);
        return byDate !== 0 ? byDate : right.id.localeCompare(left.id);
      });
  }, [fetched, liveEvents, filters]);

  return { ...query, events };
}
