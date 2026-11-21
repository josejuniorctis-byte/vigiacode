import { useEffect, useState } from 'react';
import type { Batch } from '../types';
import { useEventDetail } from '../api/hooks';
import { formatDateTime, formatRelativeTime, pluralize } from '../utils/format';
import { DiffView } from './DiffView';
import { LayerBadge } from './LayerBadge';

export function DiffDrawer({ batch, onClose }: { batch: Batch | null; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(batch?.events[0]?.id ?? null);
  }, [batch?.id]);

  useEffect(() => {
    if (!batch) return undefined;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [batch, onClose]);

  const selected = batch?.events.find((event) => event.id === selectedId) ?? batch?.events[0];
  const detail = useEventDetail(selected?.id ?? null);

  if (!batch) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <aside
        className="panel m-0 flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-none border-y-0 border-r-0 sm:m-3 sm:rounded-2xl sm:border"
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes do lote"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              Lote · {formatRelativeTime(batch.createdAt)}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text)]">
              {pluralize(batch.fileCount, 'arquivo', 'arquivos')} com diff
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {formatDateTime(batch.createdAt)} · +{batch.additions} / −{batch.deletions}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Fechar painel"
          >
            ✕
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[15rem_1fr]">
          <nav
            className="scroll-thin max-h-48 overflow-y-auto border-b border-[var(--border)] p-2 sm:max-h-none sm:border-b-0 sm:border-r"
            aria-label="Arquivos do lote"
          >
            {batch.events.map((event) => {
              const active = selected?.id === event.id;
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedId(event.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                  }`}
                >
                  <span className="block truncate font-mono text-xs" title={event.filePath}>
                    {event.filePath}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <LayerBadge layer={event.layer} />
                    <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                      +{event.additions}
                    </span>
                    <span className="font-mono text-[10px] text-rose-600 dark:text-rose-400">
                      −{event.deletions}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <section className="scroll-thin min-h-0 overflow-y-auto p-4">
            {selected ? (
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="break-all font-mono text-xs text-[var(--text)]">
                    {selected.filePath}
                  </p>
                  <span className="badge border-[var(--border)] text-[var(--muted)]">
                    {selected.changeType}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--muted)]">
                  {selected.summary ?? 'Resumo pendente…'}
                </p>
              </div>
            ) : null}

            {detail.isLoading ? (
              <div className="space-y-2" aria-label="Carregando diff">
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-4/5" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            ) : detail.isError ? (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-300">
                Não foi possível carregar o diff:{' '}
                {detail.error instanceof Error ? detail.error.message : 'erro desconhecido'}
              </p>
            ) : detail.data ? (
              <DiffView diff={detail.data.diff} truncated={detail.data.diffTruncated} />
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}
