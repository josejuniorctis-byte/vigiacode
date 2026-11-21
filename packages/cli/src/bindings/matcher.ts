import { createHash } from 'node:crypto';
import type { LLMProvider } from '../ai/index.js';
import type { EntityField, EntityInfo, ProjectMap } from './types.js';
import { nameSimilarity, normalizeEntityName, semanticKey } from './names.js';

/**
 * Matcher em duas fases:
 * 1. determinística — nome canônico de entidade/campo;
 * 2. semântica — sinônimos PT/EN, chave semântica ordenada e, opcionalmente,
 *    uma única chamada ao LLMProvider para casos ambíguos (com cache por hash).
 */

export interface SemanticLink {
  frontEntity: string;
  frontField: string;
  backEntity: string;
  backField: string;
  method: 'deterministic' | 'heuristic' | 'llm';
}

export interface MatchContext {
  map: ProjectMap;
  /** front entity::field → vínculo encontrado. */
  links: Map<string, SemanticLink>;
  /** entidade front → entidade back canônica. */
  entityLinks: Map<string, string>;
}

export interface BuildMatchOptions {
  provider?: LLMProvider | null;
  semanticMatching?: boolean;
}

export interface AmbiguousPair {
  frontEntity: string;
  frontField: string;
  candidates: Array<{ backEntity: string; backField: string }>;
}

export class MatchCache {
  private readonly entries = new Map<string, SemanticLink[]>();

  key(parts: unknown, provider: string): string {
    return createHash('sha1')
      .update(`${provider}:${JSON.stringify(parts)}`)
      .digest('hex');
  }

  get(hash: string): SemanticLink[] | undefined {
    return this.entries.get(hash);
  }

  set(hash: string, links: SemanticLink[]): void {
    this.entries.set(hash, links);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const defaultMatchCache = new MatchCache();

export async function buildMatchContext(
  map: ProjectMap,
  options: BuildMatchOptions = {},
): Promise<MatchContext> {
  const links = new Map<string, SemanticLink>();
  const entityLinks = new Map<string, string>();

  for (const [frontEntityName, frontEntity] of map.frontend) {
    const backEntity = findMatchingEntity(map.backend, frontEntityName);
    if (!backEntity) continue;
    entityLinks.set(frontEntityName, backEntity.name);

    for (const frontField of frontEntity.fields) {
      const backField = findMatchingField(backEntity, frontField.name);
      if (backField) {
        links.set(linkKey(frontEntityName, frontField.name), {
          frontEntity: frontEntityName,
          frontField: frontField.name,
          backEntity: backEntity.name,
          backField: backField.name,
          method: backField.name === frontField.name ? 'deterministic' : 'heuristic',
        });
      }
    }
  }

  if (options.semanticMatching === false) return { map, links, entityLinks };

  const ambiguous = collectAmbiguousPairs(map, links);
  if (ambiguous.length === 0) return { map, links, entityLinks };

  // Heurística local: nome parecido no mesmo entity back-end.
  const remaining: AmbiguousPair[] = [];
  for (const pair of ambiguous) {
    const best = bestHeuristicCandidate(pair);
    if (best) {
      links.set(linkKey(pair.frontEntity, pair.frontField), {
        frontEntity: pair.frontEntity,
        frontField: pair.frontField,
        backEntity: best.backEntity,
        backField: best.backField,
        method: 'heuristic',
      });
    } else {
      remaining.push(pair);
    }
  }

  if (remaining.length === 0 || !options.provider || options.provider.name === 'none') {
    return { map, links, entityLinks };
  }

  const llmLinks = await matchWithLlm(remaining, options.provider);
  for (const link of llmLinks) {
    links.set(linkKey(link.frontEntity, link.frontField), link);
  }
  return { map, links, entityLinks };
}

export function linkKey(entity: string, field: string): string {
  return `${entity}\u0000${field}`;
}

export function findMatchingEntity(
  entities: Map<string, EntityInfo>,
  rawName: string,
): EntityInfo | undefined {
  const name = normalizeEntityName(rawName);
  const exact = entities.get(name);
  if (exact) return exact;

  const semantic = semanticKey(name);
  for (const entity of entities.values()) {
    if (semanticKey(entity.name) === semantic) return entity;
  }
  return undefined;
}

export function findMatchingField(
  entity: EntityInfo | undefined,
  rawField: string,
): EntityField | undefined {
  if (!entity) return undefined;
  const exact = entity.fields.find((field) => field.name === rawField);
  if (exact) return exact;

  const semantic = semanticKey(rawField);
  return entity.fields.find((field) => semanticKey(field.name) === semantic);
}

/** Campo do banco correspondente ao campo do DTO (determinístico + sinônimos). */
export function findDatabaseField(
  map: ProjectMap,
  backEntityName: string,
  backFieldName: string,
): { entity: EntityInfo; field: EntityField } | undefined {
  const entity = findMatchingEntity(map.database, backEntityName);
  if (!entity) return undefined;
  const field = findMatchingField(entity, backFieldName);
  return field ? { entity, field } : undefined;
}

export function matchedBackendLink(
  context: MatchContext,
  frontEntity: string,
  frontField: string,
): SemanticLink | undefined {
  const direct = context.links.get(linkKey(frontEntity, frontField));
  if (direct) return direct;

  const backEntityName = context.entityLinks.get(frontEntity);
  if (!backEntityName) return undefined;
  const backEntity = context.map.backend.get(backEntityName);
  const field = findMatchingField(backEntity, frontField);
  if (!field) return undefined;
  return {
    frontEntity,
    frontField,
    backEntity: backEntityName,
    backField: field.name,
    method: field.name === frontField ? 'deterministic' : 'heuristic',
  };
}

/** Candidato "nome parecido" para a regra R8. */
export function similarBackendField(
  map: ProjectMap,
  backEntityName: string,
  frontField: string,
): { entity: EntityInfo; field: EntityField; score: number } | undefined {
  const entity = findMatchingEntity(map.backend, backEntityName);
  if (!entity) return undefined;

  let best: { entity: EntityInfo; field: EntityField; score: number } | undefined;
  for (const field of entity.fields) {
    if (field.name === frontField) continue;
    const score = nameSimilarity(frontField, field.name);
    if (score < 0.5) continue;
    if (!best || score > best.score) best = { entity, field, score };
  }
  return best;
}

function collectAmbiguousPairs(map: ProjectMap, links: Map<string, SemanticLink>): AmbiguousPair[] {
  const pairs: AmbiguousPair[] = [];

  for (const [frontEntityName, frontEntity] of map.frontend) {
    const backEntity = findMatchingEntity(map.backend, frontEntityName);
    if (!backEntity || backEntity.fields.length === 0) continue;

    for (const frontField of frontEntity.fields) {
      if (links.has(linkKey(frontEntityName, frontField.name))) continue;

      const candidates = backEntity.fields
        .filter((field) => field.rawType !== null || field.type !== 'unknown')
        .sort(
          (left, right) =>
            nameSimilarity(frontField.name, right.name) -
            nameSimilarity(frontField.name, left.name),
        )
        .slice(0, 4)
        .map((field) => ({ backEntity: backEntity.name, backField: field.name }));

      if (candidates.length > 0) {
        pairs.push({
          frontEntity: frontEntityName,
          frontField: frontField.name,
          candidates,
        });
      }
    }
  }

  return pairs;
}

function bestHeuristicCandidate(
  pair: AmbiguousPair,
): { backEntity: string; backField: string } | null {
  let best: { candidate: { backEntity: string; backField: string }; score: number } | null = null;

  for (const candidate of pair.candidates) {
    if (semanticKey(candidate.backField) === semanticKey(pair.frontField)) {
      return candidate;
    }
    const score = nameSimilarity(pair.frontField, candidate.backField);
    if (score >= 0.86 && (!best || score > best.score)) best = { candidate, score };
  }

  return best?.candidate ?? null;
}

async function matchWithLlm(
  pairs: AmbiguousPair[],
  provider: LLMProvider,
): Promise<SemanticLink[]> {
  const limited = pairs.slice(0, 20);
  const providerKey = provider.name;
  const hash = defaultMatchCache.key(limited, providerKey);
  const cached = defaultMatchCache.get(hash);
  if (cached) return cached;

  const prompt = [
    'Você faz o de-para entre campos do front-end e do back-end de um projeto.',
    'Receba pares no formato JSON e responda SOMENTE um array JSON de objetos',
    '{"frontEntity":"...","frontField":"...","backField":"..."} para os casos',
    'em que o campo do front realmente corresponde a um dos candidatos.',
    'Não invente candidatos. Se não houver correspondência, omita o par.',
    '',
    JSON.stringify(limited, null, 2),
  ].join('\n');

  let answer: string;
  try {
    answer = await provider.complete(prompt, {
      system: 'Responda apenas com JSON válido, sem markdown.',
      temperature: 0,
      maxTokens: 800,
    });
  } catch {
    return [];
  }

  const links: SemanticLink[] = [];
  const json = extractJsonArray(answer);
  if (!json) return [];

  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const frontEntity = typeof record.frontEntity === 'string' ? record.frontEntity : null;
    const frontField = typeof record.frontField === 'string' ? record.frontField : null;
    const backField = typeof record.backField === 'string' ? record.backField : null;
    if (!frontEntity || !frontField || !backField) continue;

    const pair = limited.find(
      (candidate) => candidate.frontEntity === frontEntity && candidate.frontField === frontField,
    );
    if (!pair) continue;
    const candidate = pair.candidates.find((item) => item.backField === backField);
    if (!candidate) continue;

    links.push({
      frontEntity,
      frontField,
      backEntity: candidate.backEntity,
      backField,
      method: 'llm',
    });
  }

  defaultMatchCache.set(hash, links);
  return links;
}

function extractJsonArray(value: string): unknown[] | null {
  const start = value.indexOf('[');
  const end = value.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(value.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
