import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBindingScans, useRoadmap, useSnapshots } from '../api/hooks';
import { BatchCard } from '../components/BatchCard';
import { DiffDrawer } from '../components/DiffDrawer';
import { EmptyState, LoadingPanel } from '../components/EmptyState';
import { FilterBar } from '../components/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { SnapshotRail } from '../components/SnapshotRail';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { useMergedEvents } from '../hooks/useMergedEvents';
import {
  EMPTY_FILTERS,
  EMPTY_ROADMAP_FILTERS,
  type Batch,
  type BindingDelta,
  type TimelineFilters,
} from '../types';
import { groupEvents } from '../utils/batches';

export function TimelinePage() {
  const [filters, setFilters] = useState<TimelineFilters>(EMPTY_FILTERS);
  const debouncedSearch = useDebouncedValue(filters.q, 300);
  const apiFilters = useMemo<TimelineFilters>(
    () => ({ ...filters, q: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const { events, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useMergedEvents(apiFilters);
  const snapshots = useSnapshots();
  const bindingScans = useBindingScans();
  const roadmap = useRoadmap(EMPTY_ROADMAP_FILTERS);
  const { recentBatchIds, latestBindings } = useLiveEvents();
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const batches = useMemo(() => groupEvents(events), [events]);
  const bindingDeltas = useMemo(() => {
    const deltas = new Map<string, BindingDelta>();
    for (const scan of bindingScans.data?.scans ?? []) {
      if (!scan.batchId) continue;
      deltas.set(scan.batchId, {
        created: scan.createdCount,
        resolved: scan.resolvedCount,
      });
    }
    if (latestBindings?.batchId) {
      deltas.set(latestBindings.batchId, {
        created: latestBindings.created.length,
        resolved: latestBindings.resolved.length,
      });
    }
    return deltas;
  }, [bindingScans.data, latestBindings]);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '400px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Linha do tempo"
        subtitle="Cada lote do vigia com camadas, diff e o resumo da IA. Atualiza sozinho via SSE."
        actions={
          <button type="button" className="btn" onClick={() => void refetch()}>
            ↻ Atualizar
          </button>
        }
      />

      {roadmap.data && roadmap.data.next.length > 0 ? (
        <section className="panel overflow-hidden" data-testid="next-steps">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--text)]">Próximos 5 passos</h2>
            <Link to="/architect" className="text-[11px] text-[var(--accent)] hover:underline">
              Abrir Arquiteto →
            </Link>
          </div>
          <ol className="divide-y divide-[var(--border)]">
            {roadmap.data.next.slice(0, 5).map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span className="w-5 text-center font-mono text-[11px] text-[var(--muted)]">
                  {index + 1}
                </span>
                <span
                  className={`badge border ${
                    item.priority === 'p0'
                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                      : 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                  }`}
                >
                  {item.priority.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">{item.title}</span>
                {item.module ? (
                  <span className="font-mono text-[10px] text-[var(--muted)]">{item.module}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <FilterBar
        filters={filters}
        onChange={setFilters}
        resultLabel={`${batches.length} lote(s)`}
      />

      <SnapshotRail snapshots={snapshots.data?.snapshots.slice(0, 8) ?? []} />

      {isLoading ? (
        <div className="space-y-3">
          <LoadingPanel label="Carregando lotes" />
          <LoadingPanel label="Carregando lotes" />
        </div>
      ) : isError ? (
        <EmptyState
          icon="⚠"
          title="Não foi possível carregar a linha do tempo"
          description="Confira se o servidor do VigiaCode está rodando em localhost:4317."
          action={
            <button type="button" className="btn" onClick={() => void refetch()}>
              Tentar de novo
            </button>
          }
        />
      ) : batches.length === 0 ? (
        <EmptyState
          title="Nenhum lote por aqui"
          description="Rode vigiacode start e edite alguns arquivos. Os lotes aparecem aqui em tempo real."
          action={
            <button type="button" className="btn" onClick={() => void refetch()}>
              Atualizar
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              isNew={recentBatchIds.has(batch.id)}
              bindingDelta={bindingDeltas.get(batch.id)}
              onOpen={setSelectedBatch}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden="true" />

      {hasNextPage ? (
        <button
          type="button"
          className="btn mx-auto flex"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      ) : null}

      <DiffDrawer batch={selectedBatch} onClose={() => setSelectedBatch(null)} />
    </div>
  );
}
