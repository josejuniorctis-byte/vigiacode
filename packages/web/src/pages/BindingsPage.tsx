import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useAcceptBinding,
  useBindingScans,
  useBindings,
  useBindingsMatrix,
  useBindingsSummary,
  useExplainBinding,
  useScanBindings,
} from '../api/hooks';
import { EmptyState, LoadingPanel } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useLiveEvents } from '../hooks/useLiveEvents';
import type {
  Binding,
  BindingExplanation,
  BindingLayerName,
  BindingMatrix,
  BindingScan,
  BindingStatus,
  BindingsFilters,
  MatrixCell,
  MatrixRow,
} from '../types';
import { EMPTY_BINDING_FILTERS } from '../types';
import { formatRelativeTime, pluralize } from '../utils/format';

const STATUS_ICON: Record<BindingStatus, string> = {
  red: '🔴',
  yellow: '🟡',
  green: '🟢',
};

const RULES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'];

export function BindingsPage() {
  const [filters, setFilters] = useState<BindingsFilters>(EMPTY_BINDING_FILTERS);
  const debouncedSearch = useDebouncedValue(filters.q, 300);
  const debouncedEntity = useDebouncedValue(filters.entity, 300);
  const queryFilters = useMemo<BindingsFilters>(
    () => ({ ...filters, q: debouncedSearch, entity: debouncedEntity }),
    [filters, debouncedSearch, debouncedEntity],
  );

  const bindings = useBindings(queryFilters);
  const summary = useBindingsSummary();
  const matrix = useBindingsMatrix();
  const scans = useBindingScans();
  const scan = useScanBindings();
  const accept = useAcceptBinding();
  const explain = useExplainBinding();
  const { latestBindings } = useLiveEvents();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<BindingExplanation | null>(null);

  const rows = bindings.data?.bindings ?? [];
  const counts = summary.data;

  const onExplain = (binding: Binding): void => {
    setSelectedId(binding.id);
    setExplanation(null);
    explain.mutate(binding.id, {
      onSuccess: (result) => setExplanation(result),
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Amarrações"
        subtitle="O mapa entre front-end, back-end e banco. Cada pendência mostra a regra, as referências e o que falta para fechar a amarração."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            data-testid="bindings-scan-button"
          >
            {scan.isPending ? 'Analisando…' : '↻ Escanear agora'}
          </button>
        }
      />

      {latestBindings ? (
        <div
          className="panel-soft flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-[var(--muted)]"
          role="status"
        >
          <span
            className="live-pulse size-1.5 rounded-full bg-[var(--accent)]"
            aria-hidden="true"
          />
          <span>Atualizado em tempo real pelo vigia</span>
          <span className="text-[var(--text)]">
            {latestBindings.created.length} nova(s) · {latestBindings.resolved.length} resolvida(s)
          </span>
          <span className="ml-auto font-mono">
            {latestBindings.counts.red}🔴 {latestBindings.counts.yellow}🟡{' '}
            {latestBindings.counts.green}🟢
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="🔴 Vermelhas"
          value={counts?.red ?? 0}
          hint="quebras que impedem o fluxo"
        />
        <StatCard label="🟡 Amarelas" value={counts?.yellow ?? 0} hint="parciais ou em risco" />
        <StatCard label="🟢 Verdes" value={counts?.green ?? 0} hint="front + back + banco" />
        <StatCard
          label="Saúde"
          value={`${counts?.healthPercent ?? 100}%`}
          hint={`${counts?.active ?? 0} ativa(s) · ${counts?.resolved ?? 0} resolvida(s)`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--text)]">Matriz de amarrações</h2>
            <span className="text-[11px] text-[var(--muted)]">
              entidade × front-end × back-end × banco
            </span>
          </div>
          {matrix.isLoading ? (
            <div className="p-4">
              <LoadingPanel label="Carregando matriz" />
            </div>
          ) : matrix.isError ? (
            <p className="px-4 py-6 text-sm text-rose-500">Não foi possível carregar a matriz.</p>
          ) : (matrix.data?.entities.length ?? 0) === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">
              Nenhuma entidade detectada ainda. Rode um scan para montar a matriz.
            </p>
          ) : (
            <MatrixTable matrix={matrix.data!} />
          )}
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--text)]">Evolução por scan</h2>
            <span className="text-[11px] text-[var(--muted)]">
              {pluralize(scans.data?.scans.length ?? 0, 'scan', 'scans')}
            </span>
          </div>
          <div className="p-4">
            <BindingsTrend scans={scans.data?.scans ?? []} />
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Pendências</h2>
            <p className="text-xs text-[var(--muted)]">
              {rows.length} amarração(ões) com os filtros atuais.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input"
              aria-label="Filtrar por status"
              value={filters.status}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  status: event.target.value as BindingsFilters['status'],
                }))
              }
            >
              <option value="all">Todos os status</option>
              <option value="red">🔴 Vermelhas</option>
              <option value="yellow">🟡 Amarelas</option>
              <option value="green">🟢 Verdes</option>
            </select>
            <select
              className="input"
              aria-label="Filtrar por camada"
              value={filters.layer}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  layer: event.target.value as BindingsFilters['layer'],
                }))
              }
            >
              <option value="all">Todas as camadas</option>
              <option value="frontend">Front-end</option>
              <option value="backend">Back-end</option>
              <option value="database">Banco</option>
            </select>
            <select
              className="input"
              aria-label="Filtrar por regra"
              value={filters.rule}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, rule: event.target.value }))
              }
            >
              <option value="all">Todas as regras</option>
              {RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {rule}
                </option>
              ))}
              <option value="GREEN">🟢 GREEN</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="input flex min-w-56 flex-1 items-center gap-2">
            <span className="text-[var(--muted)]" aria-hidden="true">
              ⌕
            </span>
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="Buscar por entidade, campo ou mensagem"
              aria-label="Buscar amarrações"
              value={filters.q}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, q: event.target.value }))
              }
            />
          </label>
          <input
            className="input w-48"
            placeholder="Entidade"
            aria-label="Filtrar por entidade"
            value={filters.entity}
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, entity: event.target.value }))
            }
          />
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={filters.includeResolved}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  includeResolved: event.target.checked,
                }))
              }
            />
            incluir resolvidas
          </label>
        </div>

        {bindings.isLoading ? (
          <LoadingPanel label="Carregando amarrações" />
        ) : bindings.isError ? (
          <EmptyState
            icon="⚠"
            title="Não foi possível carregar as amarrações"
            description="Confira se o servidor do VigiaCode está rodando e tente novamente."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nenhuma pendência com esses filtros"
            description="Rode um scan ou limpe os filtros. Amarrações verdes também podem ser listadas escolhendo o status 🟢."
            action={
              <button type="button" className="btn" onClick={() => scan.mutate()}>
                Escanear agora
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {rows.map((binding) => (
              <BindingRow
                key={binding.id}
                binding={binding}
                selected={selectedId === binding.id}
                explanation={selectedId === binding.id ? explanation : null}
                explaining={explain.isPending && selectedId === binding.id}
                accepting={accept.isPending}
                onExplain={() => onExplain(binding)}
                onAccept={() => accept.mutate(binding.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MatrixTable({ matrix }: { matrix: BindingMatrix }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-xs">
        <thead className="bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
          <tr>
            <th className="px-4 py-2 font-semibold">Entidade</th>
            <th className="px-2 py-2 text-center font-semibold">Front</th>
            <th className="px-2 py-2 text-center font-semibold">Back</th>
            <th className="px-2 py-2 text-center font-semibold">Banco</th>
            <th className="px-4 py-2 font-semibold">Situação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {matrix.entities.map((row) => (
            <tr key={row.entity} data-testid="matrix-row">
              <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                {row.rawName}
                <span className="ml-1.5 font-mono text-[10px] text-[var(--muted)]">
                  {row.entity}
                </span>
              </td>
              <MatrixCellView cell={row.front} />
              <MatrixCellView cell={row.back} />
              <MatrixCellView cell={row.db} />
              <td className="px-4 py-2.5">
                <MatrixLinkBadge row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixCellView({ cell }: { cell: MatrixCell }) {
  const icon =
    cell.state === 'integrated'
      ? '✅'
      : cell.state === 'partial'
        ? '🟡'
        : cell.state === 'local'
          ? '⬜'
          : cell.state === 'empty'
            ? '·'
            : '❌';
  const title = cell.ref ? `${cell.fields} campo(s) · ${cell.ref}` : `${cell.fields} campo(s)`;
  return (
    <td className="px-2 py-2.5 text-center" title={title}>
      <span aria-label={cell.state}>{icon}</span>
      {cell.fields > 0 ? (
        <span className="ml-1 font-mono text-[10px] text-[var(--muted)]">{cell.fields}</span>
      ) : null}
    </td>
  );
}

function MatrixLinkBadge({ row }: { row: MatrixRow }) {
  const map = {
    integrated: {
      icon: '✅',
      label: 'integrado',
      className: 'text-emerald-600 dark:text-emerald-400',
    },
    partial: { icon: '🟡', label: 'parcial', className: 'text-amber-600 dark:text-amber-300' },
    local: { icon: '⬜', label: 'só local', className: 'text-[var(--muted)]' },
    missing: { icon: '❌', label: 'faltando', className: 'text-rose-600 dark:text-rose-300' },
    link: { icon: '↗', label: 'falta amarrar', className: 'text-rose-600 dark:text-rose-300' },
  } as const;
  const item = map[row.link];
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${item.className}`}>
      <span aria-hidden="true">{item.icon}</span>
      {item.label}
      {row.pending > 0 ? (
        <span className="rounded-full bg-[var(--surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
          {row.pending}
        </span>
      ) : null}
    </span>
  );
}

function BindingsTrend({ scans }: { scans: BindingScan[] }) {
  const chronological = [...scans].reverse().slice(-14);
  if (chronological.length === 0) {
    return <p className="text-sm text-[var(--muted)]">Nenhum scan registrado ainda.</p>;
  }

  const max = Math.max(
    1,
    ...chronological.map((scan) => scan.redCount + scan.yellowCount + scan.greenCount),
  );

  return (
    <div>
      <div className="flex h-28 items-end gap-1.5" aria-label="Evolução por scan">
        {chronological.map((scan) => {
          const total = scan.redCount + scan.yellowCount + scan.greenCount;
          return (
            <div
              key={scan.id}
              className="flex min-w-0 flex-1 flex-col justify-end gap-0.5"
              title={`${scan.trigger} · ${scan.redCount}🔴 ${scan.yellowCount}🟡 ${scan.greenCount}🟢`}
            >
              <span
                className="w-full rounded-t bg-rose-500/80"
                style={{ height: `${(scan.redCount / max) * 100}%` }}
              />
              <span
                className="w-full bg-amber-400/80"
                style={{ height: `${(scan.yellowCount / max) * 100}%` }}
              />
              <span
                className={`w-full ${total === 0 ? 'bg-[var(--surface-3)]' : 'bg-emerald-500/80'}`}
                style={{ height: `${Math.max(scan.greenCount / max, 0.04) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--muted)]">
        <span>{chronological[0] ? formatRelativeTime(chronological[0].startedAt) : ''}</span>
        <span className="flex items-center gap-3">
          <span>🔴 {sum(chronological, 'redCount')}</span>
          <span>🟡 {sum(chronological, 'yellowCount')}</span>
          <span>🟢 {sum(chronological, 'greenCount')}</span>
        </span>
      </div>
    </div>
  );
}

function sum(scans: BindingScan[], key: 'redCount' | 'yellowCount' | 'greenCount'): number {
  return scans.reduce((total, scan) => total + scan[key], 0);
}

function BindingRow({
  binding,
  selected,
  explanation,
  explaining,
  accepting,
  onExplain,
  onAccept,
}: {
  binding: Binding;
  selected: boolean;
  explanation: BindingExplanation | null;
  explaining: boolean;
  accepting: boolean;
  onExplain: () => void;
  onAccept: () => void;
}) {
  return (
    <article
      className={`panel overflow-hidden ${selected ? 'border-[var(--border-strong)]' : ''}`}
      data-testid="binding-row"
    >
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-label={binding.status}>{STATUS_ICON[binding.status]}</span>
          <span className="badge border-[var(--border)] bg-[var(--surface-2)] font-mono text-[var(--accent)]">
            {binding.ruleId}
          </span>
          <span className="font-mono text-xs text-[var(--text)]">
            {binding.entity}.{binding.field || '*'}
          </span>
          <span className="badge border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]">
            {layerLabel(binding.layer)}
          </span>
          {binding.resolvedAt ? (
            <span className="badge border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              resolvida
            </span>
          ) : null}
          {binding.accepted ? (
            <span className="badge border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]">
              falso positivo
            </span>
          ) : null}
          <span className="ml-auto text-[10px] text-[var(--muted)]">
            visto {formatRelativeTime(binding.lastSeenAt)}
          </span>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-[var(--text)]">{binding.message}</p>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <BindingRef label="front" value={binding.frontRef} />
          <BindingRef label="back" value={binding.backRef} />
          <BindingRef label="banco" value={binding.dbRef} />
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost !px-2.5 !py-1 text-[11px]"
              onClick={onExplain}
              disabled={explaining}
            >
              {explaining ? 'Explicando…' : '✦ Explicar com IA'}
            </button>
            {!binding.accepted && !binding.resolvedAt ? (
              <button
                type="button"
                className="btn btn-ghost !px-2.5 !py-1 text-[11px]"
                onClick={onAccept}
                disabled={accepting}
              >
                Aceitar como falso positivo
              </button>
            ) : null}
          </span>
        </div>

        {selected && explanation ? (
          <div className="panel-soft mt-3 p-3" data-testid="binding-explanation">
            <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Explicação ·{' '}
              {explanation.heuristic ? 'heurística local' : `IA ${explanation.provider}`}
            </p>
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[var(--text)]">
              {explanation.explanation}
            </p>
            {explanation.suggestion ? (
              <pre className="scroll-thin mt-2 overflow-x-auto rounded-lg bg-[var(--surface-3)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text)]">
                {explanation.suggestion}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function BindingRef({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  const parsed = parseRef(value);
  return (
    <Link
      to={`/files?path=${encodeURIComponent(parsed.file)}`}
      className="inline-flex items-center gap-1 font-mono text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]"
      title={`${label}: ${value}`}
    >
      <span className="text-[var(--accent)]">{label}</span>
      {parsed.file}
      {parsed.line ? <span className="opacity-70">:{parsed.line}</span> : null}
    </Link>
  );
}

function parseRef(value: string): { file: string; line: string | null } {
  const match = /^(.*?):(\d+)$/.exec(value);
  if (!match?.[1]) return { file: value, line: null };
  return { file: match[1], line: match[2] ?? null };
}

function layerLabel(layer: BindingLayerName): string {
  return layer === 'frontend' ? 'front-end' : layer === 'backend' ? 'back-end' : 'banco';
}
