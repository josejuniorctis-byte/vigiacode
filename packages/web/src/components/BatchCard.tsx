import type { Batch, BindingDelta } from '../types';
import { formatRelativeTime, formatDateTime, pluralize, truncate } from '../utils/format';
import { LayerBadge } from './LayerBadge';

export function BatchCard({
  batch,
  isNew = false,
  bindingDelta,
  onOpen,
}: {
  batch: Batch;
  isNew?: boolean;
  bindingDelta?: BindingDelta;
  onOpen: (batch: Batch) => void;
}) {
  const previewFiles = batch.events.slice(0, 3);

  return (
    <article
      className={`panel overflow-hidden transition hover:border-[var(--border-strong)] ${
        isNew ? 'batch-new' : ''
      }`}
      data-testid="batch-card"
    >
      <button
        type="button"
        className="block w-full cursor-pointer p-5 text-left"
        onClick={() => onOpen(batch)}
        aria-label={`Ver diffs do lote de ${formatDateTime(batch.createdAt)}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <time
              dateTime={batch.createdAt}
              title={formatDateTime(batch.createdAt)}
              className="font-semibold text-[var(--text)]"
            >
              {formatRelativeTime(batch.createdAt)}
            </time>
            <span className="text-[var(--muted)]">·</span>
            <span className="text-[var(--muted)]">
              {pluralize(batch.fileCount, 'arquivo', 'arquivos')}
            </span>
            <span className="text-[var(--muted)]">·</span>
            <span className="font-mono text-xs text-[var(--muted)]">
              lote {batch.id.slice(0, 8)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {batch.layers.map((layer) => (
              <LayerBadge key={layer} layer={layer} />
            ))}
            <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              +{batch.additions}
            </span>
            <span className="font-mono text-xs font-semibold text-rose-600 dark:text-rose-400">
              −{batch.deletions}
            </span>
          </div>
        </div>

        {bindingDelta && (bindingDelta.created > 0 || bindingDelta.resolved > 0) ? (
          <p
            className="mt-3 flex flex-wrap items-center gap-2 text-xs"
            data-testid="batch-bindings"
          >
            <span className="text-[var(--accent)]">∞ amarrações</span>
            {bindingDelta.created > 0 ? (
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                +{bindingDelta.created} nova(s)
              </span>
            ) : null}
            {bindingDelta.resolved > 0 ? (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {bindingDelta.resolved} resolvida(s)
              </span>
            ) : null}
          </p>
        ) : null}

        {batch.summaryPending ? (
          <div className="mt-4 space-y-2" aria-label="gerando resumo">
            <div className="skeleton h-3 w-4/5" />
            <div className="skeleton h-3 w-3/5" />
            <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="size-1.5 rounded-full bg-[var(--accent)] live-pulse" />
              gerando resumo…
            </p>
          </div>
        ) : (
          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[var(--text)]">
            {truncate(batch.summary ?? '', 320)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {previewFiles.map((event) => (
            <span
              key={event.id}
              className="flex min-w-0 items-center gap-2 font-mono text-xs text-[var(--muted)]"
            >
              <span
                className={
                  event.changeType === 'add'
                    ? 'text-emerald-500'
                    : event.changeType === 'unlink'
                      ? 'text-rose-500'
                      : 'text-[var(--accent)]'
                }
              >
                {event.changeType === 'add' ? '+' : event.changeType === 'unlink' ? '−' : '•'}
              </span>
              <span className="max-w-[22rem] truncate">{event.filePath}</span>
            </span>
          ))}
          {batch.fileCount > previewFiles.length ? (
            <span className="text-xs text-[var(--muted)]">
              +{batch.fileCount - previewFiles.length} arquivo(s)
            </span>
          ) : null}
          <span className="ml-auto text-xs font-semibold text-[var(--accent)]">ver diffs →</span>
        </div>
      </button>
    </article>
  );
}
