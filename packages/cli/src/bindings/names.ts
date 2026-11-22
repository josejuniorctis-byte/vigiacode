/**
 * Normalização de nomes entre camadas.
 *
 * O mesmo conceito aparece como `cliente_nome`, `customerName`, `CustomerName`
 * ou `customers.name`. Aqui reduzimos tudo a tokens canônicos para que o
 * matcher determinístico case sem depender da stack do projeto.
 */

const ENTITY_SUFFIXES = new Set([
  'dto',
  'entity',
  'request',
  'response',
  'model',
  'record',
  'table',
  'schema',
  'controller',
  'repository',
  'repo',
  'service',
  'page',
  'view',
  'component',
  'form',
]);

const FRONTEND_TYPE_SUFFIXES = new Set([
  'props',
  'state',
  'context',
  'config',
  'options',
  'option',
  'event',
  'events',
  'params',
  'query',
  'result',
  'store',
  'theme',
  'style',
  'styles',
]);

/** Sinônimos PT-BR ↔ EN usados na fase semântica heurística (provider none). */
const SYNONYMS: Record<string, string> = {
  cliente: 'customer',
  customers: 'customer',
  client: 'customer',
  nome: 'name',
  completo: 'full',
  email: 'email',
  e_mail: 'email',
  telefone: 'phone',
  fone: 'phone',
  celular: 'phone',
  endereco: 'address',
  end: 'address',
  preco: 'price',
  valor: 'amount',
  quantia: 'amount',
  value: 'amount',
  quantidade: 'quantity',
  qty: 'quantity',
  criado: 'created',
  criada: 'created',
  atualizado: 'updated',
  atualizada: 'updated',
  em: 'at',
  usuario: 'user',
  usuarios: 'user',
  pedido: 'order',
  pedidos: 'order',
  produto: 'product',
  produtos: 'product',
  fornecedor: 'supplier',
  fornecedores: 'supplier',
  funcionario: 'employee',
  funcionarios: 'employee',
  descricao: 'description',
  titulo: 'title',
  codigo: 'code',
  status: 'status',
  ativo: 'active',
  saldo: 'balance',
  conta: 'account',
  data: 'date',
  nascimento: 'birth',
  total: 'total',
  desconto: 'discount',
  categoria: 'category',
  categorias: 'category',
};

export interface NamesOptions {
  /** Remove sufixos típicos de DTO/Entity/Page. */
  entity?: boolean;
}

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Divide camelCase, PascalCase, snake_case, kebab-case e pontuação. */
export function splitWords(value: string): string[] {
  const spaced = stripDiacritics(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

  return spaced.length === 0 ? [] : spaced.split(/\s+/);
}

export function singularize(word: string): string {
  if (word.length <= 2) return word;
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function normalizeEntityName(raw: string): string {
  const words = splitWords(raw);
  while (words.length > 1 && ENTITY_SUFFIXES.has(words[words.length - 1] ?? '')) {
    words.pop();
  }
  if (words.length === 0) return normalizeFieldName(raw);
  const last = words.length - 1;
  words[last] = singularize(words[last] ?? '');
  return words.join('_');
}

export function normalizeFieldName(raw: string): string {
  const words = splitWords(raw);
  if (words.length > 1 && words[words.length - 1] === 'id') {
    words.pop();
  }
  return words.join('_');
}

/** Nomes que claramente não são modelos de dados (props, estado, opções…). */
export function isAuxiliaryTypeName(raw: string): boolean {
  const words = splitWords(raw);
  const last = words[words.length - 1];
  if (!last) return false;
  return FRONTEND_TYPE_SUFFIXES.has(last);
}

export function canonicalTokens(raw: string): string[] {
  return splitWords(raw).map((word) => {
    const singular = singularize(word);
    return SYNONYMS[word] ?? SYNONYMS[singular] ?? singular;
  });
}

/** Chave semântica: tokens canônicos ordenados (cliente_nome ≈ customerName). */
export function semanticKey(raw: string): string {
  return canonicalTokens(raw)
    .filter((token) => token !== 'id')
    .sort()
    .join('_');
}

/** Jaccard dos tokens canônicos, de 0 a 1. */
export function tokenSimilarity(left: string, right: string): number {
  const a = new Set(canonicalTokens(left));
  const b = new Set(canonicalTokens(right));
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

/** Similaridade combinada (tokens + edição) para achar "nome parecido". */
export function nameSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeFieldName(left);
  const normalizedRight = normalizeFieldName(right);
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const tokenScore = tokenSimilarity(left, right);
  const editScore =
    1 -
    levenshtein(normalizedLeft, normalizedRight) /
      Math.max(normalizedLeft.length, normalizedRight.length);

  return Math.max(tokenScore, editScore * 0.9);
}

export function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[] = new Array(rows * cols).fill(0);

  for (let row = 0; row < rows; row += 1) matrix[row * cols] = row;
  for (let col = 0; col < cols; col += 1) matrix[col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      const above = matrix[(row - 1) * cols + col] ?? 0;
      const leftCell = matrix[row * cols + col - 1] ?? 0;
      const diagonal = matrix[(row - 1) * cols + col - 1] ?? 0;
      matrix[row * cols + col] = Math.min(above + 1, leftCell + 1, diagonal + cost);
    }
  }

  return matrix[rows * cols - 1] ?? 0;
}

/**
 * Compara tipos normalizados entre DTO e banco.
 * `unknown` nunca gera divergência (evita falso positivo em tipos compostos).
 */
export function typesCompatible(left: string | null, right: string | null): boolean {
  if (!left || !right || left === 'unknown' || right === 'unknown') return true;
  if (left === right) return true;
  if (left === 'json' && right === 'json') return true;
  // UUID é representado como string em DTOs (Java String, TS string).
  if ((left === 'uuid' && right === 'string') || (left === 'string' && right === 'uuid')) {
    return true;
  }
  return false;
}

/** Categorias usadas para detectar divergências entre camadas. */
export type NormalizedType =
  'string' | 'number' | 'decimal' | 'boolean' | 'date' | 'json' | 'uuid' | 'enum' | 'unknown';

export function normalizeType(raw: string | null | undefined): NormalizedType {
  if (!raw) return 'unknown';
  const value = stripDiacritics(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  if (value.length === 0) return 'unknown';

  if (/^(unknown|any|void|never|object|mixed|dynamic)$/.test(value)) return 'unknown';
  if (/(decimal|numeric|bigdecimal|money|monetary|smallmoney)/.test(value)) return 'decimal';
  if (/(uuid|guid)/.test(value)) return 'uuid';
  if (
    /(datetime|timestamp|timestamptz|date|time|instant|localdate|localdatetime|z\.date)/.test(value)
  ) {
    return 'date';
  }
  if (/(bool|boolean|tinyint\(1\))/.test(value)) return 'boolean';
  if (/(^|[^a-z])(json|jsonb|map|dictionary|record)([^a-z]|$)/.test(value)) return 'json';
  if (/(enum|literal|union|z\.enum)/.test(value)) return 'enum';
  if (
    /(varchar|nvarchar|char|text|string|str|clob|longtext|citext|email|url|slug|enum)/.test(value)
  ) {
    if (/(enum)/.test(value)) return 'enum';
    return 'string';
  }
  if (
    /(integer|int|bigint|smallint|serial|bigserial|number|float|double|real|long|short|byte|\(number\)|z\.number)/.test(
      value,
    )
  ) {
    return 'number';
  }

  // Tipos nomeados (classes Java/Python, interfaces TS).
  if (/^(string|charsequence)$/.test(value)) return 'string';
  return 'unknown';
}

/** true quando o tipo bruto é um float/double/real (regra R9 opcional). */
export function isFloatingPointType(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /(^|[^a-z])(float|double|real|number)([^a-z]|$)/i.test(raw);
}

/** true para nomes de campo que costumam representar dinheiro (R9). */
export function looksMonetary(raw: string): boolean {
  return /(price|preco|valor|amount|total|saldo|balance|cost|custo|money|pagamento|payment|receita|revenue|desconto|discount)/i.test(
    raw,
  );
}
