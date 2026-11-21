import type { LLMProvider } from '../ai/index.js';
import type { Binding } from '../db/schema.js';
import type { BindingExplanation } from './types.js';

const RULE_TITLES: Record<string, string> = {
  R1: 'campo usado no front-end sem campo no back-end',
  R2: 'campo do DTO sem coluna no banco (ou tipo divergente)',
  R3: 'schema/entidade e migrations fora de sincronia',
  R4: 'chamada do front-end para rota inexistente',
  R5: 'endpoint do back-end sem consumidor no front-end',
  R6: 'entidade com API sem tela, ou tela usando só mock/localStorage',
  R7: 'componente/rota referenciado sem definição ou import',
  R8: 'existe em outro lugar, falta amarrar',
  R9: 'valor monetário representado como float/double/number',
  R10: 'regra de arquitetura violada',
  GREEN: 'amarração consistente',
};

export interface ExplainBindingOptions {
  binding: Binding;
  provider?: LLMProvider | null;
  model?: string | null;
}

/**
 * Explica uma amarração em português e sugere o código que a fecha.
 * Com provider `none` (ou em caso de falha), usa uma explicação heurística.
 */
export async function explainBinding(options: ExplainBindingOptions): Promise<BindingExplanation> {
  const heuristic = explainHeuristic(options.binding);
  const provider = options.provider ?? null;

  if (!provider || provider.name === 'none') {
    return {
      bindingId: options.binding.id,
      provider: 'none',
      model: null,
      heuristic: true,
      explanation: heuristic.explanation,
      suggestion: heuristic.suggestion,
    };
  }

  const prompt = buildExplainPrompt(options.binding, heuristic);
  try {
    const answer = await provider.complete(prompt, {
      system:
        'Você é um engenheiro sênior explicando em português do Brasil como fechar uma amarração entre front-end, back-end e banco. Seja direto, cite os arquivos e não aplique mudanças.',
      temperature: 0.2,
      maxTokens: 700,
    });
    const parsed = parseAnswer(answer);
    return {
      bindingId: options.binding.id,
      provider: provider.name,
      model: options.model ?? null,
      heuristic: false,
      explanation: parsed.explanation || heuristic.explanation,
      suggestion: parsed.suggestion || heuristic.suggestion,
    };
  } catch {
    return {
      bindingId: options.binding.id,
      provider: provider.name,
      model: options.model ?? null,
      heuristic: true,
      explanation: heuristic.explanation,
      suggestion: heuristic.suggestion,
    };
  }
}

export function explainHeuristic(binding: Binding): {
  explanation: string;
  suggestion: string;
} {
  const title = RULE_TITLES[binding.ruleId] ?? 'amarração pendente';
  const refs = [
    binding.frontRef ? `front-end: ${binding.frontRef}` : null,
    binding.backRef ? `back-end: ${binding.backRef}` : null,
    binding.dbRef ? `banco: ${binding.dbRef}` : null,
  ].filter((item): item is string => item !== null);

  const refsText = refs.length > 0 ? ` Referências — ${refs.join(' · ')}.` : '';
  const explanation =
    `${binding.message}\n\n` +
    `A regra ${binding.ruleId} (${title}) aponta uma amarração entre as camadas: ` +
    `entidade "${binding.entity}", campo "${binding.field}". ` +
    `A correção precisa manter as três camadas falando a mesma língua.${refsText}`;

  return {
    explanation,
    suggestion: suggestCode(binding),
  };
}

function suggestCode(binding: Binding): string {
  const entity = toPascal(binding.entity);
  const field = toCamel(binding.field);
  const table = binding.entity.replaceAll('-', '_');

  switch (binding.ruleId) {
    case 'R1':
      return [
        `// back-end: acrescente o campo ao DTO de ${entity}`,
        `interface ${entity}Dto {`,
        `  ${field}?: string;`,
        `}`,
        '',
        '// banco: coluna + migration',
        `${field}: text('${toSnake(binding.field)}'),`,
        `-- migration: ALTER TABLE ${table} ADD COLUMN ${toSnake(binding.field)} TEXT;`,
      ].join('\n');
    case 'R2':
      return [
        `// banco: alinhe a coluna de ${entity}`,
        `${field}: text('${toSnake(binding.field)}'),`,
        `-- migration: ALTER TABLE ${table} ADD COLUMN ${toSnake(binding.field)} TEXT;`,
        '',
        '// DTO: ajuste o tipo para o mesmo tipo da coluna',
        `interface ${entity}Dto {`,
        `  ${field}: string;`,
        `}`,
      ].join('\n');
    case 'R3':
      return [
        '-- migration nova (não edite as antigas)',
        `ALTER TABLE ${table} ADD COLUMN ${toSnake(binding.field)} TEXT;`,
        '-- e mantenha a coluna no schema/entidade correspondente',
      ].join('\n');
    case 'R4':
      return [
        '// back-end (Fastify)',
        `app.get('${binding.field.replace(/^GET\s+/, '')}', async () => {`,
        `  return []; // TODO: implementar ${binding.field}`,
        '});',
      ].join('\n');
    case 'R5':
      return [
        '// front-end: consuma o endpoint',
        `const response = await fetch('${binding.field.replace(/^[A-Z]+\s+/, '')}');`,
        'const data = await response.json();',
      ].join('\n');
    case 'R6':
      return [
        '// front-end: troque o mock/localStorage pela API real',
        `const response = await fetch('/api/${table}');`,
        'const data = await response.json();',
      ].join('\n');
    case 'R7':
      return [
        '// importe ou defina o componente/arquivo referenciado',
        `import { ${field} } from './caminho-correto';`,
      ].join('\n');
    case 'R8':
      return [
        '// escolha um nome único e mapeie nas três camadas',
        `interface ${entity}Dto {`,
        `  ${field}: string;`,
        `}`,
      ].join('\n');
    case 'R9':
      return [
        '// banco: use decimal, não float',
        `${field}: decimal('${toSnake(binding.field)}', { precision: 12, scale: 2 }),`,
        '',
        '// ou armazene centavos como inteiro',
        `${field}Cents: integer('${toSnake(binding.field)}_cents'),`,
      ].join('\n');
    case 'R10':
      return [
        '// controller: dependa de um service, não do repository',
        'constructor(private readonly service: UsersService) {}',
      ].join('\n');
    default:
      return 'Nada a fazer: a amarração está consistente.';
  }
}

function buildExplainPrompt(
  binding: Binding,
  heuristic: { explanation: string; suggestion: string },
): string {
  return [
    'Explique a amarração pendente abaixo em português do Brasil.',
    'Diga o que falta e mostre um bloco de código curto que fecha a amarração.',
    'Não aplique nada; apenas sugira. Formato: texto explicativo e depois um bloco ```linguagem.',
    '',
    JSON.stringify(
      {
        regra: binding.ruleId,
        severidade: binding.severity,
        camada: binding.layer,
        entidade: binding.entity,
        campo: binding.field,
        mensagem: binding.message,
        frontRef: binding.frontRef,
        backRef: binding.backRef,
        dbRef: binding.dbRef,
        sugestaoBase: heuristic.suggestion,
      },
      null,
      2,
    ),
  ].join('\n');
}

function parseAnswer(answer: string): { explanation: string; suggestion: string } {
  const fence = /```[\w-]*\n([\s\S]*?)```/.exec(answer);
  if (!fence) {
    return { explanation: answer.trim(), suggestion: '' };
  }

  const code = fence[1]?.trim() ?? '';
  const explanation = answer.replace(fence[0], '').trim();
  return { explanation, suggestion: code };
}

function toPascal(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

function toCamel(value: string): string {
  const pascal = toPascal(value);
  return `${pascal[0]?.toLowerCase() ?? ''}${pascal.slice(1)}`;
}

function toSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}
