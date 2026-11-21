import { countDiffStats, uniqueLayers } from './heuristic.js';
import type { SummaryInput } from './types.js';

export const SUMMARY_SYSTEM_PROMPT =
  'Você é o CodeAnchor, um assistente que acompanha mudanças de código. ' +
  'Responda sempre em português do Brasil, de forma objetiva e sem markdown.';

const MAX_TOTAL_DIFF_CHARS = 12_000;
const MAX_DIFF_CHARS_PER_FILE = 4_000;

/** Monta o prompt em português pedindo o que mudou, a camada e o impacto. */
export function buildSummaryPrompt(input: SummaryInput): string {
  const layers = uniqueLayers(input.changes).join(', ') || 'other';
  const files = input.changes.map((change) => {
    const stats = countDiffStats(change.diff);
    return `- [${change.layer}] ${change.filePath} (${change.changeType}, +${stats.additions} −${stats.deletions})`;
  });

  const diffs: string[] = [];
  let remaining = MAX_TOTAL_DIFF_CHARS;

  for (const change of input.changes) {
    if (remaining <= 0) break;
    const limit = Math.min(MAX_DIFF_CHARS_PER_FILE, remaining);
    const excerpt =
      change.diff.length > limit ? `${change.diff.slice(0, limit)}\n... (cortado)` : change.diff;
    remaining -= excerpt.length;
    diffs.push(`### ${change.filePath}\n\`\`\`diff\n${excerpt}\n\`\`\``);
  }

  return [
    `Projeto: ${input.projectName}`,
    `Camadas detectadas: ${layers}`,
    '',
    'Arquivos alterados:',
    ...files,
    '',
    'Diffs:',
    ...diffs,
    '',
    'Escreva um resumo curto em português (no máximo 2 frases, até 320 caracteres) explicando:',
    '1. o que mudou;',
    '2. em qual camada (frontend, backend, banco ou configuração);',
    '3. o possível impacto no projeto.',
    'Não use listas, títulos ou markdown. Não repita os números do diff.',
  ].join('\n');
}
