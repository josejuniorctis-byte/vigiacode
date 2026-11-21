import type { Snapshot } from '../types';
import { formatDateTime, shortHash } from '../utils/format';

export function SnapshotRail({
  snapshots,
  emptyLabel = 'Nenhum commit registrado ainda.',
  showLabel = true,
}: {
  snapshots: Snapshot[];
  emptyLabel?: string;
  showLabel?: boolean;
}) {
  if (snapshots.length === 0) {
    return <p className="muted text-xs">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showLabel ? (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Snapshots
        </span>
      ) : null}
      {snapshots.map((snapshot) => (
        <span
          key={snapshot.id}
          className="badge border-[var(--border)] bg-[var(--surface-2)] font-mono text-[var(--muted)]"
          title={`Commit completo: ${snapshot.commitHash} · ${formatDateTime(snapshot.createdAt)}`}
        >
          <span className="text-[var(--accent)]">#</span>
          {shortHash(snapshot.commitHash)}
        </span>
      ))}
    </div>
  );
}
