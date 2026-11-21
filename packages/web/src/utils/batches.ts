import type { Batch, ChangeEvent, Layer, TimelineFilters } from '../types';
import { LAYERS } from '../types';

const LAYER_ORDER: Layer[] = [...LAYERS];

/** Agrupa eventos por batch_id e calcula os agregados exibidos no card. */
export function groupEvents(events: ChangeEvent[]): Batch[] {
  const groups = new Map<string, Batch>();

  for (const event of events) {
    const id = event.batchId ?? event.id;
    let batch = groups.get(id);

    if (!batch) {
      batch = {
        id,
        createdAt: event.createdAt,
        events: [],
        layers: [],
        fileCount: 0,
        additions: 0,
        deletions: 0,
        summary: null,
        summaryPending: true,
      };
      groups.set(id, batch);
    }

    batch.events.push(event);
    batch.additions += event.additions;
    batch.deletions += event.deletions;
    if (event.createdAt > batch.createdAt) batch.createdAt = event.createdAt;
    if (!batch.summary && event.summary) batch.summary = event.summary;
  }

  for (const batch of groups.values()) {
    batch.fileCount = batch.events.length;
    batch.events.sort((left, right) => left.filePath.localeCompare(right.filePath));
    batch.layers = uniqueLayers(batch.events);
    batch.summaryPending = batch.events.every((event) => event.summary === null);
  }

  return [...groups.values()].sort((left, right) => {
    const byDate = right.createdAt.localeCompare(left.createdAt);
    return byDate !== 0 ? byDate : right.id.localeCompare(left.id);
  });
}

export function uniqueLayers(events: ChangeEvent[]): Layer[] {
  const present = new Set<Layer>(events.map((event) => event.layer));
  return LAYER_ORDER.filter((layer) => present.has(layer));
}

export function matchesFilters(event: ChangeEvent, filters: TimelineFilters): boolean {
  if (filters.layer !== 'all' && event.layer !== filters.layer) return false;

  const search = filters.q.trim().toLowerCase();
  if (search.length > 0) {
    const haystack = `${event.filePath} ${event.summary ?? ''}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  if (filters.period !== 'all') {
    const days = filters.period === '24h' ? 1 : filters.period === '7d' ? 7 : 30;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    if (Date.parse(event.createdAt) < cutoff) return false;
  }

  return true;
}

export function groupBatchesByDay(batches: Batch[]): Array<{ date: string; batches: Batch[] }> {
  const days = new Map<string, Batch[]>();

  for (const batch of batches) {
    const key = batch.createdAt.slice(0, 10);
    const list = days.get(key) ?? [];
    list.push(batch);
    days.set(key, list);
  }

  return [...days.entries()]
    .map(([date, dayBatches]) => ({ date, batches: dayBatches }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function topLayersFor(batches: Batch[], limit = 3): Array<{ layer: Layer; count: number }> {
  const counts = new Map<Layer, number>();
  for (const batch of batches) {
    for (const event of batch.events) {
      counts.set(event.layer, (counts.get(event.layer) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([layer, count]) => ({ layer, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

export function eventAsBatch(event: ChangeEvent): Batch {
  return {
    id: event.batchId ?? event.id,
    createdAt: event.createdAt,
    events: [event],
    layers: [event.layer],
    fileCount: 1,
    additions: event.additions,
    deletions: event.deletions,
    summary: event.summary,
    summaryPending: event.summary === null,
  };
}
