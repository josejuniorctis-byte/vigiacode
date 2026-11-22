import type { BindingLayer } from '../../db/schema.js';
import {
  isAuxiliaryTypeName,
  normalizeEntityName,
  normalizeFieldName,
  normalizeType,
} from '../names.js';
import type { EntityField, EntityInfo, SourceRef } from '../types.js';

export function ref(file: string, line: number): SourceRef {
  return { file, line };
}

/** Artefatos de build com hash no nome não contêm contratos de código. */
export function isGeneratedBindingFile(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  const base = normalized.split('/').pop() ?? normalized;
  if (/^[A-Za-z0-9_$-]+-[A-Za-z0-9_-]{8,}\.(?:js|mjs|cjs|css)$/.test(base)) return true;
  return /\.(?:bundle|chunk|min)\.(?:js|mjs|cjs|css)$/i.test(base);
}

/** Remove prefixos de API, versão e parâmetros para achar a entidade. */
export function entityFromRoutePath(routePath: string): string {
  const clean = routePath
    .replace(/^https?:\/\/[^/]+/i, '')
    .split(/[?#]/)[0]
    ?.replace(/\\/g, '/')
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/:[A-Za-z0-9_]+/g, '')
    .split('/')
    .filter(Boolean);

  const ignored = new Set(['api', 'v1', 'v2', 'v3', 'rest', 'graphql', 'public', 'admin']);
  for (const segment of clean ?? []) {
    const lower = segment.toLowerCase();
    if (ignored.has(lower)) continue;
    if (/^\d+$/.test(segment)) continue;
    return normalizeEntityName(segment);
  }
  return 'endpoint';
}

/** Entidade aproximada a partir do nome do arquivo (UsersPage → user). */
export function guessEntityFromPath(file: string): string | null {
  const parts = file.replaceAll('\\', '/').split('/').filter(Boolean);
  const basename = (parts.pop() ?? '').replace(/\.[^.]+$/, '');
  const generic = new Set(['index', 'route', 'page', 'layout', 'main', 'app', 'routes']);

  let candidate = basename;
  if (generic.has(candidate.toLowerCase())) {
    candidate = parts.pop() ?? candidate;
  }

  candidate = candidate.replace(
    /(Form|FormPage|Page|View|Component|List|Card|Modal|Table|Dialog|Screen|Container)$/i,
    '',
  );
  if (candidate.length === 0) return null;
  return normalizeEntityName(candidate);
}

export function isMockFile(file: string): boolean {
  const normalized = file.replaceAll('\\', '/').toLowerCase();
  return (
    /(^|\/)(mocks?|__mocks__|fixtures?|stubs?|fake|fakes)(\/|\.|$)/.test(normalized) ||
    /(^|\/)data\/(mock|mocks|fixtures?)([-_./]|$)/.test(normalized) ||
    /(^|\/)(mock|mocks|fixture|fixtures)[-_.]/.test(normalized)
  );
}

export function normalizeRoutePath(raw: string): string {
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      // Mantém o texto original.
    }
  }

  // Remove a variável de base URL antes de interpretar `?`/`#`: o operador
  // opcional (`sessao?.apiBase`) não é uma query string.
  value = value.replace(/^\s*\$\{[^}]*\}\s*/, '');
  value = value.replace(/\$\{[^}]*\}/g, ':param');
  value = value.split(/[?#]/)[0] ?? value;
  value = value.replaceAll('\\', '/');

  if (!value.startsWith('/')) value = `/${value}`;
  value = value
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\/\d+(?=\/|$)/g, '/:param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return value.length === 0 ? '/' : value;
}

export function makeField(input: {
  rawName: string;
  rawType: string | null;
  optional?: boolean;
  ref: SourceRef;
  source: string;
}): EntityField {
  return {
    name: normalizeFieldName(input.rawName),
    rawName: input.rawName,
    rawType: input.rawType,
    type: normalizeType(input.rawType),
    optional: input.optional ?? false,
    ref: input.ref,
    source: input.source,
  };
}

/** Cria ou reaproveita uma entidade dentro do mesmo arquivo. */
export function addEntity(
  entities: EntityInfo[],
  layer: BindingLayer,
  rawName: string,
  ref_: SourceRef,
  source: string,
): EntityInfo | null {
  if (rawName.trim().length === 0 || isAuxiliaryTypeName(rawName)) return null;
  const name = normalizeEntityName(rawName);
  if (name.length === 0) return null;

  let entity = entities.find((item) => item.name === name);
  if (!entity) {
    entity = { name, rawName, layer, refs: [ref_], fields: [], sources: [source] };
    entities.push(entity);
  } else {
    entity.refs.push(ref_);
    if (!entity.sources.includes(source)) entity.sources.push(source);
  }
  return entity;
}

/** Adiciona o campo sem duplicar; a origem mais forte vence (type > dto > form). */
export function addField(entity: EntityInfo, field: EntityField): void {
  if (field.name.length === 0) return;
  const existing = entity.fields.find((item) => item.name === field.name);
  if (!existing) {
    entity.fields.push(field);
    return;
  }
  const priority: Record<string, number> = {
    type: 5,
    dto: 5,
    entity: 5,
    column: 5,
    form: 4,
    payload: 3,
    migration: 2,
  };
  if ((priority[field.source] ?? 0) > (priority[existing.source] ?? 0)) {
    const index = entity.fields.indexOf(existing);
    entity.fields[index] = field;
  }
}

/** Anota uma entidade existente como usada por mock/localStorage. */
export function markMockUsage(files: Set<string>, file: string): void {
  files.add(file);
}
