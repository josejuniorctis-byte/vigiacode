import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFileEvents, useStats } from '../api/hooks';
import { DiffDrawer } from '../components/DiffDrawer';
import { EmptyState, LoadingPanel } from '../components/EmptyState';
import { LayerBadge } from '../components/LayerBadge';
import { PageHeader } from '../components/PageHeader';
import type { Batch, ChangeEvent } from '../types';
import { eventAsBatch } from '../utils/batches';
import { formatRelativeTime, pluralize } from '../utils/format';

export function FilesPage() {
  const stats = useStats();
  const [searchParams] = useSearchParams();
  const requestedPath = searchParams.get('path');
  const [selectedPath, setSelectedPath] = useState<string | null>(requestedPath);
  const history = useFileEvents(selectedPath);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);

  const files = stats.data?.topFiles ?? [];
  const maxEvents = files[0]?.events ?? 1;

  useEffect(() => {
    if (requestedPath) setSelectedPath(requestedPath);
  }, [requestedPath]);

  useEffect(() => {
    if (!selectedPath && files[0]) setSelectedPath(files[0].filePath);
  }, [files, selectedPath]);

  const openEvent = (event: ChangeEvent): void => {
    setSelectedBatch(eventAsBatch(event));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Arquivos"
        subtitle="Ranking dos arquivos mais alterados e o histórico de cada um, com o último resumo da IA."
      />

      {stats.isLoading ? (
        <LoadingPanel label="Carregando arquivos" />
      ) : stats.isError ? (
        <EmptyState
          icon="⚠"
          title="Falha ao carregar os arquivos"
          description="Verifique se o servidor do VigiaCode está rodando."
        />
      ) : files.length === 0 ? (
        <EmptyState
          title="Nenhum arquivo alterado ainda"
          description="Edite arquivos com o vigia ativo para montar o ranking."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">Mais alterados</h2>
              <span className="text-xs text-[var(--muted)]">
                {pluralize(files.length, 'arquivo', 'arquivos')}
              </span>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {files.map((file, index) => {
                const active = selectedPath === file.filePath;
                return (
                  <li key={file.filePath}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(file.filePath)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                        active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-xs text-[var(--muted)]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs text-[var(--text)]">
                          {file.filePath}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2">
                          <LayerBadge layer={file.layer} />
                          <span className="text-[11px] text-[var(--muted)]">
                            {pluralize(file.events, 'evento', 'eventos')} ·{' '}
                            {formatRelativeTime(file.lastChangedAt)}
                          </span>
                        </span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <span
                            className="block h-full rounded-full bg-[var(--accent)]"
                            style={{ width: `${Math.max(4, (file.events / maxEvents) * 100)}%` }}
                          />
                        </span>
                        {file.lastSummary ? (
                          <span className="mt-1.5 line-clamp-2 block text-[11px] leading-relaxed text-[var(--muted)]">
                            {file.lastSummary}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="panel h-fit p-4 lg:sticky lg:top-20">
            <h2 className="text-sm font-semibold text-[var(--text)]">Histórico do arquivo</h2>
            {!selectedPath ? (
              <p className="muted mt-3 text-xs">
                Selecione um arquivo no ranking para ver o histórico de mudanças.
              </p>
            ) : history.isLoading ? (
              <div className="mt-3 space-y-2">
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            ) : history.isError ? (
              <p className="mt-3 text-xs text-rose-500">Não foi possível carregar o histórico.</p>
            ) : (history.data?.events.length ?? 0) === 0 ? (
              <p className="muted mt-3 text-xs">Nenhum evento registrado para este arquivo.</p>
            ) : (
              <div className="mt-3">
                <p className="break-all font-mono text-[11px] text-[var(--accent)]">
                  {selectedPath}
                </p>
                <ul className="scroll-thin mt-2 max-h-[26rem] space-y-1 overflow-y-auto pr-1">
                  {history.data?.events.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-2 text-left hover:bg-[var(--surface-2)]"
                        onClick={() => openEvent(event)}
                      >
                        <span className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-[var(--muted)]">
                            {formatRelativeTime(event.createdAt)}
                          </span>
                          <span className="font-mono">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              +{event.additions}
                            </span>{' '}
                            <span className="text-rose-600 dark:text-rose-400">
                              −{event.deletions}
                            </span>
                          </span>
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs text-[var(--text)]">
                          {event.summary ?? 'Resumo pendente…'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}

      <DiffDrawer batch={selectedBatch} onClose={() => setSelectedBatch(null)} />
    </div>
  );
}
