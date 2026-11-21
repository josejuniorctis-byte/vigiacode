import path from 'node:path';
import type { ChangeEventLayer } from '../db/schema.js';
import type { SummaryChange, SummaryInput } from './types.js';

const LAYER_ORDER: ChangeEventLayer[] = ['frontend', 'backend', 'database', 'config', 'other'];

const IMPACT: Record<ChangeEventLayer, string> = {
  frontend: 'mudanças de interface podem exigir ajuste no contrato consumido do back-end.',
  backend: 'revise contratos de API e validações antes de consumir no front-end.',
  database: 'schema/migrations podem exigir atualização de tipos e queries.',
  config: 'configuração afeta build/execução; confirme variáveis de ambiente.',
  other: 'verifique dependências, documentação e testes relacionados.',
};

/** Conta linhas adicionadas/removidas de um diff unificado. */
export function countDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }

  return { additions, deletions };
}

/** Resumo heurístico local, usado pelo provider `none` e como fallback. */
export function summarizeHeuristic(input: SummaryInput): string {
  const changes = input.changes;
  if (changes.length === 0) return 'Nenhuma mudança registrada.';

  const stats = changes.reduce(
    (acc, change) => {
      const partial = countDiffStats(change.diff);
      acc.additions += partial.additions;
      acc.deletions += partial.deletions;
      return acc;
    },
    { additions: 0, deletions: 0 },
  );

  const layers = uniqueLayers(changes);
  const layerLabel = layers.length > 0 ? layers.join(', ') : 'other';
  const location = changes.length === 1 ? (changes[0]?.filePath ?? '') : batchLocation(changes);
  const fileWord = changes.length === 1 ? 'arquivo' : 'arquivos';
  const verb = batchVerb(changes);
  const impact = IMPACT[layers[0] ?? 'other'];

  return (
    `${changes.length} ${fileWord} ${verb} em ${location}: ` +
    `+${stats.additions} −${stats.deletions}. ` +
    `Camada: ${layerLabel}. Impacto provável: ${impact}`
  );
}

export function uniqueLayers(changes: SummaryChange[]): ChangeEventLayer[] {
  const seen = new Set<ChangeEventLayer>();
  for (const change of changes) seen.add(change.layer);
  return LAYER_ORDER.filter((layer) => seen.has(layer));
}

function batchVerb(changes: SummaryChange[]): string {
  if (changes.every((change) => change.changeType === 'unlink')) {
    return changes.length === 1 ? 'removido' : 'removidos';
  }
  if (changes.every((change) => change.changeType === 'add')) {
    return changes.length === 1 ? 'adicionado' : 'adicionados';
  }
  return changes.length === 1 ? 'alterado' : 'alterados';
}

/** Diretório comum das mudanças, em formato POSIX e relativo à raiz. */
export function commonDirectory(changes: SummaryChange[]): string {
  const dirs = changes.map((change) => path.posix.dirname(change.filePath.replaceAll('\\', '/')));
  const [first, ...rest] = dirs;
  if (!first) return 'raiz do projeto';

  let segments = first === '.' ? [] : first.split('/').filter(Boolean);
  for (const dir of rest) {
    const other = dir === '.' ? [] : dir.split('/').filter(Boolean);
    segments = segments.filter((segment, index) => other[index] === segment);
    if (segments.length === 0) break;
  }

  return segments.length > 0 ? segments.join('/') : 'raiz do projeto';
}

/**
 * Localização legível do lote: diretório comum quando existe; caso contrário,
 * os diretórios de topo (ex.: "src, db") em vez de "raiz do projeto".
 */
export function batchLocation(changes: SummaryChange[]): string {
  const common = commonDirectory(changes);
  if (common !== 'raiz do projeto') return common;

  const tops = [
    ...new Set(
      changes
        .map((change) => change.filePath.replaceAll('\\', '/').split('/')[0])
        .filter((segment): segment is string => Boolean(segment)),
    ),
  ];

  return tops.length > 0 ? tops.slice(0, 3).join(', ') : 'raiz do projeto';
}

/** Normaliza a resposta da IA: uma linha, sem markdown excessivo. */
export function sanitizeSummary(value: string, maxLength = 600): string {
  const collapsed = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}
