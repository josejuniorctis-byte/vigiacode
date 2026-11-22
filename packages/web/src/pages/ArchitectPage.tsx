import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useArchitectPlan,
  useGenerateRoadmap,
  useRoadmap,
  useUpdateRoadmapItem,
} from '../api/hooks';
import { EmptyState, LoadingPanel } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useLiveEvents } from '../hooks/useLiveEvents';
import type {
  RoadmapChecklistEntry,
  RoadmapFilters,
  RoadmapItem,
  RoadmapKind,
  RoadmapPriority,
  RoadmapStatus,
} from '../types';
import { EMPTY_ROADMAP_FILTERS } from '../types';
import { formatRelativeTime } from '../utils/format';

const COLUMNS: Array<{ status: RoadmapStatus; label: string; icon: string }> = [
  { status: 'todo', label: 'A fazer', icon: '☐' },
  { status: 'doing', label: 'Em andamento', icon: '🔵' },
  { status: 'blocked', label: 'Bloqueado', icon: '⛔' },
  { status: 'done', label: 'Concluído', icon: '✅' },
];

const KIND_LABEL: Record<RoadmapKind, string> = {
  feature: '✨ feature',
  fix: '🐞 fix',
  debt: '🧹 dívida',
  binding: '🔗 amarração',
  test: '🧪 teste',
  doc: '📄 doc',
};

const KINDS = Object.keys(KIND_LABEL) as RoadmapKind[];
const PRIORITIES: RoadmapPriority[] = ['p0', 'p1', 'p2', 'p3'];

const PRIORITY_CLASS: Record<RoadmapPriority, string> = {
  p0: 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300',
  p1: 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300',
  p2: 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-300',
  p3: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]',
};

export function ArchitectPage() {
  const [filters, setFilters] = useState<RoadmapFilters>(EMPTY_ROADMAP_FILTERS);
  const [objective, setObjective] = useState('');
  const debouncedSearch = useDebouncedValue(filters.q, 300);
  const debouncedModule = useDebouncedValue(filters.module, 300);
  const queryFilters = useMemo<RoadmapFilters>(
    () => ({ ...filters, q: debouncedSearch, module: debouncedModule }),
    [filters, debouncedSearch, debouncedModule],
  );

  const roadmap = useRoadmap(queryFilters);
  const generate = useGenerateRoadmap();
  const plan = useArchitectPlan();
  const update = useUpdateRoadmapItem();
  const { latestRoadmap } = useLiveEvents();

  const items = roadmap.data?.items ?? [];
  const counts = roadmap.data?.counts;

  const byStatus = useMemo(() => {
    const map: Record<RoadmapStatus, RoadmapItem[]> = {
      todo: [],
      doing: [],
      blocked: [],
      done: [],
    };
    for (const item of items) map[item.status].push(item);
    return map;
  }, [items]);

  const setStatus = (item: RoadmapItem, status: RoadmapStatus): void => {
    if (item.status === status) return;
    update.mutate({ id: item.id, patch: { status } });
  };

  const toggleChecklist = (item: RoadmapItem, index: number): void => {
    const checklist: RoadmapChecklistEntry[] = item.checklist.map((entry, current) =>
      current === index ? { ...entry, done: !entry.done } : entry,
    );
    update.mutate({ id: item.id, patch: { checklist } });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Arquiteto"
        subtitle="Roadmap vivo derivado do código: amarrações 🔴, TODOs e arquivos quentes. Itens gerados se fecham sozinhos com evidência."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => generate.mutate(false)}
              disabled={generate.isPending}
              data-testid="roadmap-generate-button"
            >
              {generate.isPending ? 'Gerando…' : '↻ Gerar roadmap'}
            </button>
          </div>
        }
      />

      {latestRoadmap ? (
        <div
          className="panel-soft flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-[var(--muted)]"
          role="status"
        >
          <span
            className="live-pulse size-1.5 rounded-full bg-[var(--accent)]"
            aria-hidden="true"
          />
          <span>Roadmap atualizado em tempo real</span>
          <span className="text-[var(--text)]">
            {latestRoadmap.created} criado(s) · {latestRoadmap.reopened} reaberto(s) ·{' '}
            {latestRoadmap.closed} fechado(s)
          </span>
          <span className="ml-auto font-mono">
            {latestRoadmap.counts.todo} a fazer · {latestRoadmap.counts.doing} fazendo ·{' '}
            {latestRoadmap.counts.done} feitos
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="☐ A fazer" value={counts?.todo ?? 0} hint="itens abertos" />
        <StatCard label="🔵 Em andamento" value={counts?.doing ?? 0} hint="em execução" />
        <StatCard label="⛔ Bloqueados" value={counts?.blocked ?? 0} hint="precisam de decisão" />
        <StatCard label="✅ Concluídos" value={counts?.done ?? 0} hint="histórico do roadmap" />
      </div>

      <section className="panel p-4">
        <div className="flex flex-wrap items-end gap-2">
          <select
            className="input"
            aria-label="Filtrar tipo"
            value={filters.kind}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                kind: event.target.value as RoadmapFilters['kind'],
              }))
            }
          >
            <option value="all">Todos os tipos</option>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Filtrar prioridade"
            value={filters.priority}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                priority: event.target.value as RoadmapFilters['priority'],
              }))
            }
          >
            <option value="all">Todas as prioridades</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority.toUpperCase()}
              </option>
            ))}
          </select>
          <input
            className="input w-40"
            placeholder="Módulo"
            aria-label="Filtrar módulo"
            value={filters.module}
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, module: event.target.value }))
            }
          />
          <label className="input flex min-w-48 flex-1 items-center gap-2">
            <span className="text-[var(--muted)]" aria-hidden="true">
              ⌕
            </span>
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="Buscar por título, descrição ou módulo"
              aria-label="Buscar no roadmap"
              value={filters.q}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, q: event.target.value }))
              }
            />
          </label>
          <div className="flex items-center gap-2">
            <input
              className="input w-56"
              placeholder="Objetivo para o plano com IA"
              aria-label="Objetivo do plano"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={plan.isPending || objective.trim().length === 0}
              onClick={() =>
                plan.mutate(objective.trim(), {
                  onSuccess: () => setObjective(''),
                })
              }
              data-testid="architect-plan-button"
            >
              {plan.isPending ? 'Planejando…' : '✦ Gerar plano com IA'}
            </button>
          </div>
        </div>

        {generate.data ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Roadmap gerado: {generate.data.created} criado(s), {generate.data.reopened} reaberto(s),{' '}
            {generate.data.closed} fechado(s).
          </p>
        ) : null}
        {plan.data ? (
          <p className="mt-3 text-xs text-[var(--muted)]" data-testid="plan-result">
            Plano gerado por{' '}
            {plan.data.heuristic ? 'heurística local' : `IA (${plan.data.provider})`} com{' '}
            {plan.data.items.length} passo(s). Objetivo: {plan.data.objective}
          </p>
        ) : null}
        {plan.isError ? (
          <p className="mt-3 text-xs text-rose-500">
            Não foi possível gerar o plano. Confira o provider de IA configurado.
          </p>
        ) : null}
      </section>

      {roadmap.isLoading ? (
        <LoadingPanel label="Carregando roadmap" />
      ) : roadmap.isError ? (
        <EmptyState
          icon="⚠"
          title="Não foi possível carregar o roadmap"
          description="Confira se o servidor do VigiaCode está rodando e tente novamente."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Roadmap vazio com esses filtros"
          description="Rode um scan de amarrações e clique em Gerar roadmap para derivar os próximos passos do código."
          action={
            <button type="button" className="btn" onClick={() => generate.mutate(true)}>
              Gerar roadmap
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-4">
          {COLUMNS.map((column) => (
            <section
              key={column.status}
              className="panel overflow-hidden"
              data-testid="kanban-column"
            >
              <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                <h2 className="text-xs font-semibold text-[var(--text)]">
                  <span aria-hidden="true">{column.icon}</span> {column.label}
                </h2>
                <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                  {byStatus[column.status].length}
                </span>
              </header>
              <div className="scroll-thin max-h-[34rem] space-y-2 overflow-y-auto p-2">
                {byStatus[column.status].length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11px] text-[var(--muted)]">
                    Nenhum item.
                  </p>
                ) : (
                  byStatus[column.status].map((item) => (
                    <RoadmapCard
                      key={item.id}
                      item={item}
                      busy={update.isPending}
                      onStatus={(status) => setStatus(item, status)}
                      onToggleChecklist={(index) => toggleChecklist(item, index)}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function RoadmapCard({
  item,
  busy,
  onStatus,
  onToggleChecklist,
}: {
  item: RoadmapItem;
  busy: boolean;
  onStatus: (status: RoadmapStatus) => void;
  onToggleChecklist: (index: number) => void;
}) {
  return (
    <article className="panel-soft p-3" data-testid="roadmap-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`badge border ${PRIORITY_CLASS[item.priority]}`}>
          {item.priority.toUpperCase()}
        </span>
        <span className="badge border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]">
          {KIND_LABEL[item.kind]}
        </span>
        {item.source !== 'manual' ? (
          <span className="text-[10px] text-[var(--muted)]">auto · {item.source}</span>
        ) : null}
      </div>

      <h3 className="mt-2 text-sm font-semibold leading-snug text-[var(--text)]">{item.title}</h3>
      {item.description ? (
        <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[var(--muted)]">
          {item.description}
        </p>
      ) : null}

      {item.module ? (
        <p className="mt-1.5 font-mono text-[10px] text-[var(--accent)]">módulo {item.module}</p>
      ) : null}

      {item.evidence.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {item.evidence.slice(0, 4).map((evidence) => (
            <li key={evidence} className="font-mono text-[10px] text-[var(--muted)]">
              {evidence}
            </li>
          ))}
        </ul>
      ) : null}

      {item.links.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.links
            .filter((link) => link.filePath)
            .slice(0, 4)
            .map((link) => (
              <Link
                key={`${item.id}-${link.filePath}`}
                to={`/files?path=${encodeURIComponent(link.filePath ?? '')}`}
                className="badge border-[var(--border)] bg-[var(--surface-2)] font-mono text-[10px] text-[var(--muted)] hover:text-[var(--accent)]"
              >
                {shortPath(link.filePath ?? '')}
              </Link>
            ))}
        </div>
      ) : null}

      {item.checklist.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {item.checklist.map((entry, index) => (
            <li key={`${item.id}-${entry.label}`}>
              <label className="flex items-start gap-1.5 text-[11px] text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={entry.done}
                  disabled={busy}
                  onChange={() => onToggleChecklist(index)}
                  className="mt-0.5"
                />
                <span className={entry.done ? 'text-[var(--muted)] line-through' : ''}>
                  {entry.label}
                  {entry.evidence ? (
                    <span className="ml-1 font-mono text-[9px] text-[var(--muted)]">
                      {entry.evidence}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
        <select
          className="input !py-0.5 !text-[10px]"
          aria-label={`Status de ${item.title}`}
          value={item.status}
          disabled={busy}
          onChange={(event) => onStatus(event.target.value as RoadmapStatus)}
        >
          {COLUMNS.map((column) => (
            <option key={column.status} value={column.status}>
              {column.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[10px] text-[var(--muted)]">
          {formatRelativeTime(item.updatedAt)}
        </span>
      </div>
    </article>
  );
}

function shortPath(filePath: string): string {
  const segments = filePath.replaceAll('\\', '/').split('/');
  return segments.slice(-2).join('/');
}
