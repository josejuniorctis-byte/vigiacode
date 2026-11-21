import { LAYERS, type Layer, type TimelineFilters } from '../types';

const LAYER_OPTIONS: Array<{ value: Layer | 'all'; label: string }> = [
  { value: 'all', label: 'Todas as camadas' },
  ...LAYERS.map((layer) => ({
    value: layer,
    label:
      layer === 'database'
        ? 'Banco de dados'
        : layer === 'other'
          ? 'Outros'
          : layer === 'config'
            ? 'Configuração'
            : layer.charAt(0).toUpperCase() + layer.slice(1),
  })),
];

const PERIOD_OPTIONS: Array<{ value: TimelineFilters['period']; label: string }> = [
  { value: 'all', label: 'Todo o período' },
  { value: '24h', label: 'Últimas 24 h' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

export function FilterBar({
  filters,
  onChange,
  resultLabel,
}: {
  filters: TimelineFilters;
  onChange: (filters: TimelineFilters) => void;
  resultLabel?: string;
}) {
  const hasFilters = filters.layer !== 'all' || filters.q.trim() !== '' || filters.period !== 'all';

  return (
    <div className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">
          ⌕
        </span>
        <input
          className="input input-icon w-full"
          placeholder="Buscar por caminho ou resumo…"
          aria-label="Buscar por caminho ou resumo"
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
      </div>

      <select
        className="input w-full sm:w-44"
        aria-label="Filtrar por camada"
        value={filters.layer}
        onChange={(event) => onChange({ ...filters, layer: event.target.value as Layer | 'all' })}
      >
        {LAYER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        className="input w-full sm:w-44"
        aria-label="Filtrar por período"
        value={filters.period}
        onChange={(event) =>
          onChange({
            ...filters,
            period: event.target.value as TimelineFilters['period'],
          })
        }
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {hasFilters ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onChange({ layer: 'all', q: '', period: 'all' })}
        >
          Limpar
        </button>
      ) : null}

      {resultLabel ? (
        <span className="whitespace-nowrap text-xs text-[var(--muted)] sm:ml-1">{resultLabel}</span>
      ) : null}
    </div>
  );
}
