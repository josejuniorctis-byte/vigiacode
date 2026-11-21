import type { Layer } from '../types';

const LABELS: Record<Layer, string> = {
  frontend: 'frontend',
  backend: 'backend',
  database: 'banco',
  config: 'config',
  other: 'outros',
};

const STYLES: Record<Layer, string> = {
  frontend: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  backend: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  database: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  config: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  other: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300',
};

export function LayerBadge({ layer }: { layer: Layer }) {
  return (
    <span className={`badge ${STYLES[layer]}`} title={`Camada ${LABELS[layer]}`}>
      <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
      {LABELS[layer]}
    </span>
  );
}

export function layerLabel(layer: Layer): string {
  return LABELS[layer];
}
