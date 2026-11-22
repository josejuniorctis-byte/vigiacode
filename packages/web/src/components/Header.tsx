import { useAiStatus, useHealth, useProject } from '../api/hooks';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { useTheme } from '../hooks/useTheme';
import { shortHash } from '../utils/format';
import type { StreamStatus } from '../hooks/useEventStream';

function Dot({ tone, pulse = false }: { tone: 'ok' | 'bad' | 'idle'; pulse?: boolean }) {
  const color = tone === 'ok' ? 'bg-emerald-400' : tone === 'bad' ? 'bg-rose-400' : 'bg-slate-400';
  return (
    <span
      className={`size-1.5 rounded-full ${color} ${pulse ? 'live-pulse' : ''}`}
      aria-hidden="true"
    />
  );
}

const STREAM_LABEL: Record<StreamStatus, string> = {
  live: 'ao vivo',
  connecting: 'conectando',
  offline: 'offline',
};

export function Header() {
  const health = useHealth();
  const project = useProject();
  const ai = useAiStatus();
  const { theme, toggleTheme } = useTheme();
  const { status: streamStatus } = useLiveEvents();

  const apiOnline = health.isSuccess && !health.isError;
  const apiTone = apiOnline ? 'ok' : health.isError ? 'bad' : 'idle';
  const streamTone = streamStatus === 'live' ? 'ok' : streamStatus === 'offline' ? 'bad' : 'idle';

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-sky-400/30 bg-sky-400/10 text-lg">
            ⚓
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--text)]">
              {project.data?.name ?? 'VigiaCode'}
            </p>
            <p className="flex items-center gap-1.5 truncate text-[11px] text-[var(--muted)]">
              {project.data?.branch ? (
                <>
                  <span className="font-mono">{project.data.branch}</span>
                  <span>·</span>
                </>
              ) : null}
              <span className="font-mono">
                {project.data?.commitHash ? shortHash(project.data.commitHash) : 'sem commit'}
              </span>
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span
            className="badge border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
            title="Status da API local"
          >
            <Dot tone={apiTone} pulse={apiOnline} />
            {apiOnline ? 'API online' : health.isError ? 'API offline' : 'API…'}
          </span>

          <span
            className="badge hidden border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] sm:inline-flex"
            title="Status da conexão SSE"
          >
            <Dot tone={streamTone} pulse={streamStatus === 'live'} />
            {STREAM_LABEL[streamStatus]}
          </span>

          <span
            className="badge hidden border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] lg:inline-flex"
            title={
              ai.data
                ? `Provider de IA: ${ai.data.provider}${ai.data.keyPresent ? '' : ' (chave ausente)'}`
                : 'Status da IA'
            }
          >
            <span className="text-[var(--accent)]">✦</span>
            {ai.data ? (
              <>
                {ai.data.provider}
                {ai.data.model ? <span className="opacity-70">· {ai.data.model}</span> : null}
                {!ai.data.keyPresent ? <span className="text-amber-500">!</span> : null}
              </>
            ) : (
              'IA…'
            )}
          </span>

          <button
            type="button"
            className="btn btn-ghost !px-2.5"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </div>
    </header>
  );
}
