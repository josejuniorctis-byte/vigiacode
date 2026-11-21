import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {label}
        </p>
        {icon ? <span className="text-[var(--accent)]">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
