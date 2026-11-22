import { useMutation } from '@tanstack/react-query';
import { useAiStatus, useConfig } from '../api/hooks';
import { testAi } from '../api/client';
import { EmptyState, LoadingPanel } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import type { AiTestResult } from '../types';
import { formatDateTime } from '../utils/format';

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="break-all text-right font-mono text-xs text-[var(--text)]">
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  );
}

export function SettingsPage() {
  const config = useConfig();
  const ai = useAiStatus();
  const mutation = useMutation<AiTestResult, Error, void>({ mutationFn: testAi });

  if (config.isLoading) return <LoadingPanel label="Carregando configurações" />;

  if (config.isError || !config.data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Configurações"
          subtitle="Configuração local do VigiaCode (somente leitura)."
        />
        <EmptyState
          icon="⚠"
          title="Configuração indisponível"
          description="O servidor não expôs /api/config. Confirme se o start está rodando em localhost:4317."
        />
      </div>
    );
  }

  const appConfig = config.data;
  const keyPresent = ai.data?.keyPresent ?? false;
  const keyRequired = appConfig.llm.provider !== 'none' && appConfig.llm.provider !== 'ollama';
  const keyLabel = !keyRequired
    ? 'sem chave necessária'
    : keyPresent
      ? 'chave presente'
      : 'chave ausente';
  const result = mutation.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configurações"
        subtitle="Somente leitura nesta etapa. As chaves nunca saem do ambiente e não aparecem aqui."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--text)]">Projeto</h2>
            <span className="badge border-[var(--border)] text-[var(--muted)]">read-only</span>
          </div>
          <div className="mt-3">
            <Row label="Nome" value={appConfig.project.name} />
            <Row label="Raiz" value={appConfig.project.rootPath} />
            <Row
              label="Banco"
              value={`${appConfig.database.dialect} · ${appConfig.database.file}`}
            />
            <Row label="API" value={`${appConfig.server.host}:${appConfig.server.port}`} />
          </div>
        </section>

        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--text)]">IA</h2>
            <span
              className={`badge ${
                !keyRequired
                  ? 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300'
                  : keyPresent
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              }`}
            >
              {keyLabel}
            </span>
          </div>
          <div className="mt-3">
            <Row label="Provider" value={appConfig.llm.provider} />
            <Row label="Modelo" value={ai.data?.model ?? appConfig.llm.model} />
            <Row label="Endpoint" value={appConfig.llm.baseUrl} />
            <Row label="Timeout" value={`${appConfig.llm.timeoutMs} ms`} />
            <Row label="Max tokens" value={appConfig.llm.maxTokens} />
            <Row label="Temperatura" value={appConfig.llm.temperature} />
            <Row
              label="Fallbacks"
              value={
                appConfig.llm.fallbackProviders.length > 0
                  ? appConfig.llm.fallbackProviders.join(' → ')
                  : 'nenhum'
              }
            />
            <Row
              label="Último healthCheck"
              value={
                ai.data?.lastHealthCheck
                  ? `${ai.data.lastHealthCheck.ok ? 'ok' : 'falhou'} · ${formatDateTime(ai.data.lastHealthCheck.checkedAt)}`
                  : 'ainda não verificado'
              }
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Testando…' : 'Testar IA'}
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              Usa a mesma chamada do <code className="font-mono">vigiacode ai test</code>.
            </span>
          </div>

          {result ? (
            <div
              className={`mt-3 rounded-xl border p-3 text-xs ${
                result.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              }`}
              role="status"
            >
              <p className="font-semibold">
                {result.ok ? `Resposta em ${result.elapsedMs} ms` : 'Falha no teste'}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">
                {result.ok ? result.response : result.error}
              </p>
            </div>
          ) : null}
          {mutation.isError ? (
            <p className="mt-3 text-xs text-rose-500">{mutation.error.message}</p>
          ) : null}
        </section>

        <section className="panel p-5">
          <h2 className="text-sm font-semibold text-[var(--text)]">Vigia</h2>
          <div className="mt-3">
            <Row label="Debounce" value={`${appConfig.watch.debounceMs} ms`} />
            <Row label="Arquivo máximo" value={`${appConfig.watch.maxFileSizeKb} KB`} />
            <Row label="Diff máximo" value={`${appConfig.git.maxDiffKb} KB`} />
            <Row
              label="Caminhos"
              value={appConfig.watch.paths
                .map((p) => (p === '.' ? 'raiz do projeto' : p))
                .join(', ')}
            />
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-sm font-semibold text-[var(--text)]">Chaves de API</h2>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Configure por variável de ambiente ou em{' '}
            <code className="font-mono">.vigiacode/.env</code>. As chaves nunca são gravadas no
            config nem no banco; este painel mostra apenas se elas estão presentes.
          </p>
          <div className="mt-3">
            <Row
              label="Chave disponível?"
              value={!keyRequired ? 'não necessária' : keyPresent ? 'sim' : 'não'}
            />
            <Row label="openai" value="OPENAI_API_KEY ou VIGIACODE_API_KEY" />
            <Row label="anthropic" value="ANTHROPIC_API_KEY ou VIGIACODE_API_KEY" />
            <Row label="gemini" value="GEMINI_API_KEY / GOOGLE_API_KEY" />
            <Row label="openai-compatible" value="VIGIACODE_API_KEY" />
          </div>
        </section>
      </div>
    </div>
  );
}
