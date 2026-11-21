import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  icon = '⚓',
  action,
}: {
  title: string;
  description: string;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-[var(--muted)]">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function LoadingPanel({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="panel space-y-3 p-5" aria-label={label}>
      <div className="skeleton h-3 w-1/3" />
      <div className="skeleton h-4 w-4/5" />
      <div className="skeleton h-4 w-2/3" />
    </div>
  );
}
