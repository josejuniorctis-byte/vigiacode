import { normalizeEntityName, normalizeFieldName, normalizeType } from './names.js';
import type { EntityField, EntityInfo, FileExtract, MigrationField, ProjectMap } from './types.js';

/**
 * Junta os mapas por arquivo num mapa normalizado do projeto.
 *
 * Entidades das três camadas são mescladas por nome canônico; migrations SQL
 * ficam separadas (`migrationColumns`) para que R3 consiga comparar o schema
 * do ORM com o que as migrations realmente criam.
 */
export function combineExtracts(extracts: FileExtract[]): ProjectMap {
  const map: ProjectMap = {
    frontend: new Map(),
    backend: new Map(),
    database: new Map(),
    endpoints: [],
    calls: [],
    routes: [],
    imports: [],
    jsx: [],
    definitions: new Map(),
    files: extracts,
    migrationColumns: new Map(),
    migrationFiles: [],
    mockFiles: new Set(),
    localStorageFiles: new Set(),
  };

  const migrationFiles = new Set<string>();

  for (const extract of extracts) {
    map.endpoints.push(...extract.endpoints);
    map.calls.push(...extract.calls);
    map.routes.push(...extract.routes);
    map.imports.push(...extract.imports);
    map.jsx.push(...extract.jsx);

    for (const definition of extract.definitions) {
      const refs = map.definitions.get(definition) ?? [];
      refs.push({ file: extract.file, line: 1 });
      map.definitions.set(definition, refs);
    }

    if (extract.mockFile) map.mockFiles.add(extract.file);
    if (extract.localStorage) map.localStorageFiles.add(extract.file);

    for (const entity of extract.entities) {
      const target =
        extract.layer === 'frontend'
          ? map.frontend
          : extract.layer === 'backend'
            ? map.backend
            : map.database;
      mergeEntity(target, entity);
    }

    for (const migration of extract.migrations) {
      const columns = map.migrationColumns.get(migration.entity) ?? new Map();
      for (const field of migration.fields) {
        if (field.removed) columns.delete(field.name);
        else columns.set(field.name, field);
      }
      map.migrationColumns.set(migration.entity, columns);
      if (!migrationFiles.has(extract.file)) {
        migrationFiles.add(extract.file);
        map.migrationFiles.push({ file: extract.file, line: 1 });
      }
    }
  }

  // Toda rota pertence a uma entidade, mesmo quando o projeto não declara DTO.
  for (const endpoint of map.endpoints) {
    if (map.backend.has(endpoint.entity)) continue;
    map.backend.set(endpoint.entity, {
      name: endpoint.entity,
      rawName: endpoint.entity,
      layer: 'backend',
      refs: [endpoint.ref],
      fields: [],
      sources: ['route'],
    });
  }

  // Projeto que só tem SQL (sem ORM): as migrations são a própria definição do
  // banco e entram no mapa para permitir amarrações verdes.
  if (map.database.size === 0 && map.migrationColumns.size > 0) {
    for (const [entityName, columns] of map.migrationColumns) {
      const entity: EntityInfo = {
        name: entityName,
        rawName: entityName,
        layer: 'database',
        refs: [],
        fields: [],
        sources: ['migration'],
      };
      for (const field of columns.values()) {
        entity.fields.push(migrationFieldToEntityField(field));
        entity.refs.push(field.ref);
      }
      map.database.set(entityName, entity);
    }
  }

  return map;
}

function mergeEntity(target: Map<string, EntityInfo>, incoming: EntityInfo): void {
  const existing = target.get(incoming.name);
  if (!existing) {
    target.set(incoming.name, {
      ...incoming,
      fields: [...incoming.fields],
      refs: [...incoming.refs],
      sources: [...incoming.sources],
    });
    return;
  }

  existing.rawName = existing.rawName || incoming.rawName;
  for (const ref of incoming.refs) {
    if (!existing.refs.some((item) => item.file === ref.file && item.line === ref.line)) {
      existing.refs.push(ref);
    }
  }
  for (const source of incoming.sources) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
  }

  for (const field of incoming.fields) {
    const index = existing.fields.findIndex((item) => item.name === field.name);
    if (index === -1) {
      existing.fields.push(field);
      continue;
    }
    const current = existing.fields[index];
    if (current && fieldPriority(field) > fieldPriority(current)) {
      existing.fields[index] = field;
    }
  }
}

function fieldPriority(field: EntityField): number {
  switch (field.source) {
    case 'type':
    case 'dto':
    case 'entity':
    case 'column':
      return 5;
    case 'form':
      return 4;
    case 'payload':
      return 3;
    case 'migration':
      return 2;
    default:
      return 1;
  }
}

function migrationFieldToEntityField(field: MigrationField): EntityField {
  return {
    name: normalizeFieldName(field.name),
    rawName: field.rawName,
    rawType: field.rawType,
    type: normalizeType(field.rawType),
    optional: true,
    ref: field.ref,
    source: 'migration',
  };
}

/** Converte nomes de migration para o namespace canônico de entidade. */
export function canonicalMigrationEntity(rawName: string): string {
  return normalizeEntityName(rawName);
}
