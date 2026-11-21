import { useEffect, useState } from 'react';

type ApiState = 'loading' | 'online' | 'offline';

interface HealthResponse {
  status: string;
  version: string;
}

interface ProjectResponse {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
}

type StepStatus = 'done' | 'next' | 'planned';

interface RoadmapStep {
  step: number;
  title: string;
  description: string;
  status: StepStatus;
}

const ROADMAP: RoadmapStep[] = [
  {
    step: 1,
    title: 'Fundação & Estrutura',
    description: 'Monorepo, CLI, banco local com Drizzle, API Fastify e esta interface.',
    status: 'done',
  },
  {
    step: 2,
    title: 'O Vigia',
    description: 'chokidar + simple-git capturam diffs, resumos e snapshots em tempo real.',
    status: 'done',
  },
  {
    step: 3,
    title: 'Detecção de amarrações',
    description: 'Liga front-end, back-end e banco por entidade e campo.',
    status: 'next',
  },
  {
    step: 4,
    title: 'Motor de IA',
    description: 'Resumos e sugestões com provider byok ou ollama.',
    status: 'planned',
  },
  {
    step: 5,
    title: 'Dashboard',
    description: 'Timeline de eventos e mapa visual das amarrações.',
    status: 'planned',
  },
  {
    step: 6,
    title: 'Snapshots & Relatórios',
    description: 'Evolução da arquitetura ao longo do tempo, pronta para CI.',
    status: 'planned',
  },
];

export default function App() {
  const [apiState, setApiState] = useState<ApiState>('loading');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [project, setProject] = useState<ProjectResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const healthResponse = await fetch('/api/health');
        if (!healthResponse.ok) {
          throw new Error(`HTTP ${healthResponse.status}`);
        }

        const healthData = (await healthResponse.json()) as HealthResponse;
        if (cancelled) return;

        setHealth(healthData);
        setApiState(healthData.status === 'ok' ? 'online' : 'offline');

        const projectResponse = await fetch('/api/project');
        if (!projectResponse.ok) return;

        const projectData = (await projectResponse.json()) as ProjectResponse;
        if (!cancelled) setProject(projectData);
      } catch {
        if (!cancelled) setApiState('offline');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="anchor-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl"
        aria-hidden="true"
      />

      <main className="relative mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10 sm:py-16">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-sky-400/30 bg-sky-400/10 text-xl">
              ⚓
            </span>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-200">CodeAnchor</p>
              <p className="text-xs text-slate-500">AI Dev Companion</p>
            </div>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
            Etapa 2 · O Vigia
          </span>
        </header>

        <section className="mt-16 sm:mt-24">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge state={apiState} version={health?.version ?? null} />
            <span className="text-xs text-slate-500">localhost:4317</span>
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            CodeAnchor rodando
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            A fundação e o vigia estão prontos: cada mudança vira um evento com diff, camada e
            resumo em português. O detector de amarrações e o dashboard entram nas próximas etapas.
          </p>
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Projeto"
            value={project?.name ?? '—'}
            hint={project ? project.rootPath : 'aguardando /api/project'}
          />
          <StatCard
            label="Eventos capturados"
            value="tempo real"
            hint="veja /api/events ou `codeanchor log`"
          />
          <StatCard label="Amarrações" value="—" hint="detecção chega na Etapa 3" />
        </section>

        <section className="mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Roadmap
            </h2>
            <span className="text-xs text-slate-500">2 de 6 concluídas</span>
          </div>

          <ol className="mt-5 space-y-4">
            {ROADMAP.map((item) => (
              <RoadmapRow key={item.step} item={item} />
            ))}
          </ol>
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-6 text-xs text-slate-600">
          <span>CodeAnchor · MIT · fundação + vigia (Etapas 1 e 2)</span>
          <span>/api/health · /api/project · /api/events</span>
        </footer>
      </main>
    </div>
  );
}

function StatusBadge({ state, version }: { state: ApiState; version: string | null }) {
  const styles: Record<ApiState, { label: string; text: string; dot: string; ring: string }> = {
    loading: {
      label: 'conectando…',
      text: 'text-slate-300',
      dot: 'bg-slate-400',
      ring: 'border-slate-500/30 bg-slate-500/10',
    },
    online: {
      label: 'API online',
      text: 'text-emerald-300',
      dot: 'bg-emerald-400',
      ring: 'border-emerald-500/30 bg-emerald-500/10',
    },
    offline: {
      label: 'API offline',
      text: 'text-rose-300',
      dot: 'bg-rose-400',
      ring: 'border-rose-500/30 bg-rose-500/10',
    },
  };

  const current = styles[state];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${current.ring} ${current.text}`}
    >
      <span
        className={`size-1.5 rounded-full ${current.dot} ${state === 'online' ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      {current.label}
      {version ? <span className="text-slate-500">v{version}</span> : null}
    </span>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-3 truncate text-lg font-semibold text-slate-100" title={value}>
        {value}
      </p>
      <p className="mt-1 truncate text-sm text-slate-500" title={hint}>
        {hint}
      </p>
    </div>
  );
}

function RoadmapRow({ item }: { item: RoadmapStep }) {
  const marker =
    item.status === 'done'
      ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
      : item.status === 'next'
        ? 'border-sky-400/40 bg-sky-400/10 text-sky-300'
        : 'border-white/10 bg-white/[0.03] text-slate-500';

  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${marker}`}
      >
        {item.status === 'done' ? '✓' : item.step}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
          {item.title}
          {item.status === 'next' ? (
            <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
              próxima
            </span>
          ) : null}
          {item.status === 'done' ? (
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
              concluída
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
      </div>
    </li>
  );
}
