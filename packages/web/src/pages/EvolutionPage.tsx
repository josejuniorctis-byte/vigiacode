import { useMemo, useState } from 'react';
import { useSnapshots, useStats } from '../api/hooks';
import { BatchCard } from '../components/BatchCard';
import { DiffDrawer } from '../components/DiffDrawer';
import { EmptyState, LoadingPanel } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SnapshotRail } from '../components/SnapshotRail';
import { StatCard } from '../components/StatCard';
import { useMergedEvents } from '../hooks/useMergedEvents';
import { EMPTY_FILTERS, type Batch } from '../types';
import { groupBatchesByDay, groupEvents, topLayersFor } from '../utils/batches';
import { formatDayLabel, pluralize } from '../utils/format';
import { LayerBadge } from '../components/LayerBadge';

export function EvolutionPage() {
  const { events, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useMergedEvents(EMPTY_FILTERS, 200);
  const stats = useStats();
  const snapshots = useSnapshots();
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);

  const batches = useMemo(() => groupEvents(events), [events]);
  const days = useMemo(() => groupBatchesByDay(batches), [batches]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agenda de Evolução"
        subtitle="A história do projeto por dia, com lotes consolidados e marcadores de commit."
        actions={
          <button type="button" className="btn" onClick={() => void refetch()}>
            ↻ Atualizar
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Eventos"
          value={stats.data?.totalEvents ?? '—'}
          hint="mudanças capturadas"
        />
        <StatCard
          label="Lotes"
          value={stats.data?.totalBatches ?? '—'}
          hint="agrupados pelo vigia"
        />
        <StatCard
          label="Arquivos"
          value={stats.data?.totalFiles ?? '—'}
          hint="distintos no projeto"
        />
        <StatCard
          label="Camada mais ativa"
          value={stats.data?.byLayer[0]?.layer ?? '—'}
          hint={
            stats.data?.byLayer[0] ? `${stats.data.byLayer[0].events} evento(s)` : 'sem dados ainda'
          }
        />
      </div>

      <SnapshotRail snapshots={snapshots.data?.snapshots.slice(0, 12) ?? []} />

      {isLoading ? (
        <LoadingPanel label="Carregando agenda" />
      ) : isError ? (
        <EmptyState
          icon="⚠"
          title="Falha ao carregar a agenda"
          description="O servidor local pode estar offline. Verifique localhost:4317."
          action={
            <button type="button" className="btn" onClick={() => void refetch()}>
              Tentar de novo
            </button>
          }
        />
      ) : days.length === 0 ? (
        <EmptyState
          title="A agenda ainda está vazia"
          description="Assim que o vigia capturar mudanças, os dias aparecem aqui agrupados."
        />
      ) : (
        <div className="space-y-6">
          {days.map((day) => {
            const daySnapshots =
              snapshots.data?.snapshots.filter(
                (snapshot) => snapshot.createdAt.slice(0, 10) === day.date,
              ) ?? [];
            const layers = topLayersFor(day.batches);
            const files = day.batches.reduce((total, batch) => total + batch.fileCount, 0);

            return (
              <section key={day.date} className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold capitalize text-[var(--text)]">
                      {formatDayLabel(day.date)}
                    </h2>
                    <p className="text-xs text-[var(--muted)]">
                      {pluralize(day.batches.length, 'lote', 'lotes')} ·{' '}
                      {pluralize(files, 'arquivo', 'arquivos')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {layers.map(({ layer, count }) => (
                      <span key={layer} className="flex items-center gap-1">
                        <LayerBadge layer={layer} />
                        <span className="text-[10px] text-[var(--muted)]">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {daySnapshots.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      Commits
                    </span>
                    <SnapshotRail snapshots={daySnapshots} showLabel={false} />
                  </div>
                ) : null}

                <div className="space-y-2">
                  {day.batches.map((batch) => (
                    <BatchCard key={batch.id} batch={batch} onOpen={setSelectedBatch} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {hasNextPage ? (
        <button
          type="button"
          className="btn mx-auto flex"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Carregando…' : 'Carregar dias anteriores'}
        </button>
      ) : null}

      <DiffDrawer batch={selectedBatch} onClose={() => setSelectedBatch(null)} />
    </div>
  );
}
