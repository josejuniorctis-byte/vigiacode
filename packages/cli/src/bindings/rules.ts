import path from 'node:path';
import type { BindingRuleId, BindingsConfig } from '../config.js';
import type { BindingStatus } from '../db/schema.js';
import type { EndpointInfo, Finding, FrontendCall, ProjectMap, SourceRef } from './types.js';
import type { MatchContext } from './matcher.js';
import { isGeneratedBindingFile } from './extractors/common.js';
import {
  findMatchingEntity,
  findMatchingField,
  findDatabaseField,
  matchedBackendLink,
  similarBackendField,
} from './matcher.js';
import {
  isAuxiliaryTypeName,
  isFloatingPointType,
  looksMonetary,
  nameSimilarity,
  normalizeEntityName,
  normalizeFieldName,
  typesCompatible,
} from './names.js';

/** Tipos globais/utilitários que nunca são contratos de dados. */
const GLOBAL_FRONT_TYPES = new Set([
  'window',
  'document',
  'node',
  'element',
  'htmlelement',
  'event',
  'request',
  'response',
  'headers',
  'formdata',
  'blob',
  'file',
  'url',
  'urlsearchparams',
  'storage',
  'processenv',
  'importmeta',
  'jsx',
  'react',
  'fragment',
]);

/** DTOs de leitura/projeção não precisam espelhar colunas do banco. */
const PROJECTION_NAME =
  /(Response|View|Projection|Summary|Resumo|Report|ReportResponse|Dashboard|Stats|Statistics|Lookup|Option|Page|Result)$/i;

/** Chaves genéricas de envelope não são campos de contrato. */
const GENERIC_PAYLOAD_KEYS = new Set(['payload', 'body', 'data', 'params', 'query', 'headers']);

/**
 * Colunas herdadas de `@MappedSuperclass`/BaseEntity e auditoria. O extractor
 * de JPA vê apenas a classe concreta; não acusar essas colunas evita uma
 * enxurrada de falsos positivos.
 */
const INHERITED_COLUMNS = new Set([
  'id',
  'tenant',
  'tenant_id',
  'filial',
  'filial_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'version',
  'created_by',
  'updated_by',
]);

/** Arquivo que define um DTO de leitura/projeção. */
const PROJECTION_FILE =
  /(Response|View|Projection|Summary|Resumo|Report|Dashboard|Stats|Lookup|Option|Result|Page)\.(?:java|kt|ts|tsx|js|jsx)$/i;

function isProjectionRef(file: string | undefined): boolean {
  return Boolean(file && PROJECTION_FILE.test(file));
}

/** Campos calculados/derivados que não precisam existir como coluna. */
const DERIVED_FIELD =
  /(_nome|_descricao|_cor|_total|_percentual|_resumo|_saldo|_url|_imagem|_quantidade|_contagem|_contas|_count)$/i;

function isDerivedField(field: { name: string; rawType: string | null }): boolean {
  if (/(^|[^a-z])(list|set|map|collection|page|array)([^a-z]|$)/i.test(field.rawType ?? '')) {
    return true;
  }
  if (/\[\]$/.test(field.rawType ?? '')) return true;
  if (['linhas', 'itens', 'total', 'quantidade'].includes(field.name)) return true;
  return DERIVED_FIELD.test(field.name);
}

/**
 * Regras de detecção R1–R10.
 *
 * Cada finding carrega id da regra, severidade (já ajustada pela config),
 * mensagem em português e referências arquivo:linha. A amarração saudável
 * (front + back + banco consistentes) vira um finding GREEN.
 */
export function evaluateRules(
  map: ProjectMap,
  match: MatchContext,
  config: BindingsConfig,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const pending = new Set<string>();
  const blockedEntities = new Set<string>();

  const add = (finding: Finding): void => {
    if (matchesAccepted(config.acceptedFalsePositives, finding)) return;
    const key = `${finding.ruleId}\u0000${finding.layer}\u0000${finding.entity}\u0000${finding.field}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
    if (finding.field === '*') {
      blockedEntities.add(finding.entity);
    } else {
      pending.add(`${finding.entity}\u0000${finding.field}`);
    }
  };

  const rules = config.rules;
  const enabled = (id: BindingRuleId): boolean => rules[id]?.enabled === true;
  const severityFor = (id: BindingRuleId, fallback: BindingStatus): BindingStatus => {
    const configured = rules[id]?.severity;
    return configured ?? fallback;
  };

  if (enabled('R1') || enabled('R8')) {
    applyFieldRules(map, match, config, add, enabled, severityFor);
  }

  if (enabled('R2')) {
    applyR2(map, add, severityFor);
  }

  if (enabled('R3')) {
    applyR3(map, add, severityFor);
  }

  if (enabled('R4')) {
    applyR4(map, add, severityFor);
  }

  if (enabled('R5')) {
    applyR5(map, add, severityFor);
  }

  if (enabled('R6')) {
    applyR6(map, add, severityFor);
  }

  if (enabled('R7')) {
    applyR7(map, add, severityFor);
  }

  if (enabled('R9')) {
    applyR9(map, add, severityFor);
  }

  if (enabled('R10')) {
    applyR10(map, add, severityFor);
  }

  // Amarrações verdes: campo presente e consistente nas três camadas.
  for (const [frontEntityName, frontEntity] of map.frontend) {
    if (isIgnoredFrontEntity(frontEntity)) continue;
    if (isMockOnly(map, frontEntityName)) continue;

    const backEntity = findMatchingEntity(map.backend, frontEntityName);
    const dbEntity = findMatchingEntity(map.database, frontEntityName);
    if (!backEntity || !dbEntity) continue;

    for (const frontField of frontEntity.fields) {
      const link = matchedBackendLink(match, frontEntityName, frontField.name);
      if (!link) continue;

      const dbField = findMatchingField(dbEntity, link.backField);
      if (!dbField) continue;

      const backField = findMatchingField(backEntity, link.backField);
      if (!backField) continue;
      if (!typesCompatible(backField.type, dbField.type)) continue;

      if (
        blockedEntities.has(frontEntityName) ||
        blockedEntities.has(backEntity.name) ||
        blockedEntities.has(dbEntity.name) ||
        pending.has(`${frontEntityName}\u0000${frontField.name}`) ||
        pending.has(`${backEntity.name}\u0000${backField.name}`) ||
        pending.has(`${dbEntity.name}\u0000${dbField.name}`)
      ) {
        continue;
      }

      add({
        ruleId: 'GREEN',
        layer: 'backend',
        entity: backEntity.name,
        field: backField.name,
        status: 'green',
        severity: 'green',
        message: `Campo "${frontField.rawName}" está amarrado entre front-end, back-end e banco.`,
        frontRef: frontField.ref,
        backRef: backField.ref,
        dbRef: dbField.ref,
        suggestion: 'Nada a fazer: contrato, DTO e banco estão consistentes.',
      });
    }
  }

  return findings;
}

function applyFieldRules(
  map: ProjectMap,
  match: MatchContext,
  config: BindingsConfig,
  add: (finding: Finding) => void,
  enabled: (id: BindingRuleId) => boolean,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  for (const [frontEntityName, frontEntity] of map.frontend) {
    if (frontEntity.fields.length === 0) continue;
    if (isIgnoredFrontEntity(frontEntity)) continue;
    if (isMockOnly(map, frontEntityName)) continue;

    const backEntity = findMatchingEntity(map.backend, frontEntityName);
    const hasBackContract = Boolean(backEntity);
    const hasCall = map.calls.some((call) => call.entity === frontEntityName);

    for (const frontField of frontEntity.fields) {
      const link = matchedBackendLink(match, frontEntityName, frontField.name);
      if (link) continue;

      const similar = backEntity
        ? similarBackendField(map, frontEntityName, frontField.name)
        : undefined;

      if (similar && enabled('R8')) {
        add({
          ruleId: 'R8',
          layer: 'frontend',
          entity: frontEntityName,
          field: frontField.name,
          status: severityFor('R8', 'yellow'),
          severity: severityFor('R8', 'yellow'),
          message: `[R8] Existe em outro lugar, falta amarrar: o front-end usa "${frontField.rawName}", mas o back-end tem "${similar.field.rawName}".`,
          frontRef: frontField.ref,
          backRef: similar.field.ref,
          suggestion: `Renomeie/mapeie "${frontField.rawName}" para "${similar.field.rawName}" no DTO e no formulário.`,
        });
        continue;
      }

      if (!enabled('R1')) continue;
      // Se a rota existe mas o extractor não achou DTO/campos no back-end, não
      // há evidência suficiente para afirmar que o campo falta. R1 fica
      // conservadora nesse caso (evita culpar o front por DTO não reconhecido).
      if (backEntity && backEntity.fields.length === 0) continue;

      // R1 é sobre o contrato de ENTRADA: formulário/payload sempre contam.
      // Tipos/interfaces só entram quando a entidade tem DTO/rota no back-end
      // (ou quando o projeto liga `r1IncludeTypes` explicitamente).
      const isInput = frontField.source === 'form' || frontField.source === 'payload';
      const includeTypes = config.r1IncludeTypes !== false;
      if (!isInput && !(includeTypes && (hasBackContract || hasCall))) continue;
      if (GENERIC_PAYLOAD_KEYS.has(frontField.name)) continue;

      add({
        ruleId: 'R1',
        layer: 'backend',
        entity: backEntity?.name ?? frontEntityName,
        field: frontField.name,
        status: severityFor('R1', 'red'),
        severity: severityFor('R1', 'red'),
        message: backEntity
          ? `[R1] Campo "${frontField.rawName}" usado no front-end não existe no DTO/rota de "${backEntity.rawName}" no back-end.`
          : `[R1] Campo "${frontField.rawName}" usado no front-end não tem entidade/DTO correspondente no back-end.`,
        frontRef: frontField.ref,
        backRef: backEntity?.refs[0],
        suggestion: `Adicione "${frontField.rawName}" ao DTO de ${backEntity?.rawName ?? frontEntity.rawName} e à entidade/migration correspondente.`,
      });
      void config;
    }
  }
}

function applyR2(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  if (map.database.size === 0) return;

  for (const [backEntityName, backEntity] of map.backend) {
    if (backEntity.fields.length === 0) continue;
    // DTOs de resposta, projections e view models não são contratos de
    // persistência. R2 só compara quando a entidade espelha uma tabela e o
    // nome não indica uma projeção de leitura.
    if (PROJECTION_NAME.test(backEntity.rawName)) continue;
    const dbEntity = findMatchingEntity(map.database, backEntityName);

    if (!dbEntity) continue;

    for (const backField of backEntity.fields) {
      const dbField = findMatchingField(dbEntity, backField.name);
      if (!dbField) {
        if (INHERITED_COLUMNS.has(backField.name)) continue;
        if (isProjectionRef(backField.ref.file)) continue;
        if (isDerivedField(backField)) continue;
        add({
          ruleId: 'R2',
          layer: 'database',
          entity: dbEntity.name,
          field: backField.name,
          status: severityFor('R2', 'red'),
          severity: severityFor('R2', 'red'),
          message: `[R2] Campo "${backField.rawName}" do DTO de "${backEntity.rawName}" não tem coluna em "${dbEntity.rawName}".`,
          backRef: backField.ref,
          dbRef: dbEntity.refs[0],
          suggestion: `Adicione a coluna "${backField.rawName}" em ${dbEntity.rawName} e na migration.`,
        });
        continue;
      }

      if (!typesCompatible(backField.type, dbField.type)) {
        add({
          ruleId: 'R2',
          layer: 'database',
          entity: dbEntity.name,
          field: dbField.name,
          status: 'yellow',
          severity: 'yellow',
          message: `[R2] Tipo divergente para "${backField.rawName}": DTO ${backField.rawType ?? '?'} × banco ${dbField.rawType ?? '?'}.`,
          backRef: backField.ref,
          dbRef: dbField.ref,
          suggestion: `Alinhe o tipo de "${dbField.rawName}" entre DTO e schema (${backField.rawType ?? '?'} × ${dbField.rawType ?? '?'}).`,
        });
      }
    }
  }
}

function applyR3(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  if (map.migrationFiles.length === 0 || map.migrationColumns.size === 0) return;

  for (const [dbEntityName, dbEntity] of map.database) {
    if (dbEntity.sources.length === 1 && dbEntity.sources[0] === 'migration') continue;
    // Só compara entidades realmente mapeadas por ORM/schema; tipos de UI que
    // caíram no mapa de banco não são contrato de persistência.
    if (!dbEntity.sources.some((source) => source === 'entity' || source === 'column')) continue;
    const columns = map.migrationColumns.get(dbEntityName);

    if (!columns) {
      if (dbEntity.fields.length === 0) continue;
      add({
        ruleId: 'R3',
        layer: 'database',
        entity: dbEntityName,
        field: '*',
        status: severityFor('R3', 'yellow'),
        severity: severityFor('R3', 'yellow'),
        message: `[R3] Entidade/tabela "${dbEntity.rawName}" não aparece em nenhuma migration.`,
        dbRef: dbEntity.refs[0],
        suggestion: `Crie a migration que cria a tabela ${dbEntity.rawName}.`,
      });
      continue;
    }

    for (const field of dbEntity.fields) {
      if (columns.has(field.name)) continue;
      if (INHERITED_COLUMNS.has(field.name)) continue;
      add({
        ruleId: 'R3',
        layer: 'database',
        entity: dbEntityName,
        field: field.name,
        status: severityFor('R3', 'yellow'),
        severity: severityFor('R3', 'yellow'),
        message: `[R3] Coluna "${field.rawName}" existe no schema/entidade de "${dbEntity.rawName}", mas nenhuma migration a cria.`,
        dbRef: field.ref,
        suggestion: `Adicione "${field.rawName}" em uma migration nova (ALTER TABLE ${dbEntity.rawName} ADD COLUMN ...).`,
      });
    }

    for (const [fieldName, field] of columns) {
      if (findMatchingField(dbEntity, fieldName)) continue;
      if (INHERITED_COLUMNS.has(fieldName)) continue;
      add({
        ruleId: 'R3',
        layer: 'database',
        entity: dbEntityName,
        field: fieldName,
        status: severityFor('R3', 'yellow'),
        severity: severityFor('R3', 'yellow'),
        message: `[R3] Coluna "${field.rawName}" existe em migration, mas sumiu do schema/entidade de "${dbEntity.rawName}".`,
        dbRef: field.ref,
        suggestion: `Remova a coluna da migration ou recrie-a no schema de ${dbEntity.rawName}.`,
      });
    }
  }

  // Tabelas que só existem em migrations e não têm ORM correspondente não são
  // necessariamente quebra: podem ser views, tabelas de auditoria ou objetos
  // gerenciados por outro serviço. R3 compara apenas entidades que existem nas
  // duas camadas (ORM/schema × migrations).
}

function applyR4(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  const seen = new Set<string>();
  for (const call of map.calls) {
    const key = `${call.method} ${call.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (map.endpoints.some((endpoint) => routeMatches(call, endpoint))) continue;

    add({
      ruleId: 'R4',
      layer: 'frontend',
      entity: call.entity,
      field: key,
      status: severityFor('R4', 'red'),
      severity: severityFor('R4', 'red'),
      message: `[R4] Chamada do front-end para rota inexistente no back-end: ${call.method} ${call.path}.`,
      frontRef: call.ref,
      suggestion: `Implemente ${call.method} ${call.path} no back-end ou remova/corrija a chamada no front-end.`,
    });
  }
}

function applyR5(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  const seen = new Set<string>();
  for (const endpoint of map.endpoints) {
    if (endpoint.method === 'HEAD' || endpoint.method === 'OPTIONS') continue;
    const key = `${endpoint.method} ${endpoint.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (map.calls.some((call) => routeMatches(call, endpoint))) continue;

    add({
      ruleId: 'R5',
      layer: 'backend',
      entity: endpoint.entity,
      field: key,
      status: severityFor('R5', 'yellow'),
      severity: severityFor('R5', 'yellow'),
      message: `[R5] Endpoint sem consumidor no front-end: ${endpoint.method} ${endpoint.path}.`,
      backRef: endpoint.ref,
      suggestion: `Consuma ${endpoint.method} ${endpoint.path} em uma tela/página ou remova o endpoint.`,
    });
  }
}

function applyR6(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  const endpointEntities = new Set(map.endpoints.map((endpoint) => endpoint.entity));
  const reported = new Set<string>();

  for (const [entityName, backEntity] of map.backend) {
    if (!endpointEntities.has(entityName)) continue;
    if (reported.has(entityName)) continue;

    const frontEntity = map.frontend.get(entityName);
    const calls = map.calls.filter((call) => call.entity === entityName);
    const mockOnly = frontEntity ? isMockOnly(map, entityName) : false;

    if (mockOnly) {
      reported.add(entityName);
      add({
        ruleId: 'R6',
        layer: 'frontend',
        entity: entityName,
        field: '*',
        status: severityFor('R6', 'yellow'),
        severity: severityFor('R6', 'yellow'),
        message: `[R6] A tela de "${backEntity.rawName}" só usa mock/localStorage: falta ligar na API.`,
        frontRef: frontEntity?.refs[0],
        backRef: backEntity.refs[0],
        suggestion: `Troque o mock/localStorage de ${backEntity.rawName} por chamadas reais aos endpoints.`,
      });
      continue;
    }

    if (!frontEntity && calls.length === 0) {
      reported.add(entityName);
      add({
        ruleId: 'R6',
        layer: 'frontend',
        entity: entityName,
        field: '*',
        status: severityFor('R6', 'yellow'),
        severity: severityFor('R6', 'yellow'),
        message: `[R6] A entidade "${backEntity.rawName}" tem API, mas nenhuma tela/página a consome.`,
        backRef: backEntity.refs[0],
        suggestion: `Crie uma tela para ${backEntity.rawName} ou marque o endpoint como interno.`,
      });
    }
  }
}

function applyR7(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  const existing = new Set(map.files.map((file) => file.file));
  const definitions = new Set(map.definitions.keys());
  const known = new Set([
    'Fragment',
    'Suspense',
    'StrictMode',
    'Profiler',
    'Route',
    'Routes',
    'Outlet',
    'Link',
    'NavLink',
    'RouterProvider',
  ]);

  for (const extract of map.files) {
    const imported = new Set(extract.imports.flatMap((item) => item.names));

    for (const item of extract.imports) {
      if (!item.relative) continue;
      const extension = path.extname(item.specifier).toLowerCase();
      if (
        [
          '.css',
          '.scss',
          '.less',
          '.svg',
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.json',
          '.gif',
        ].includes(extension)
      ) {
        continue;
      }
      if (resolveLocalImport(extract.file, item.specifier, existing)) continue;
      if (isGeneratedBindingFile(item.specifier)) continue;

      add({
        ruleId: 'R7',
        layer: 'frontend',
        entity: normalizeEntityName(path.basename(item.specifier)),
        field: item.specifier,
        status: severityFor('R7', 'red'),
        severity: severityFor('R7', 'red'),
        message: `[R7] Import relativo não encontrado: "${item.specifier}" em ${extract.file}.`,
        frontRef: { file: extract.file, line: item.line },
        suggestion: `Crie o arquivo "${item.specifier}" ou corrija o caminho do import.`,
      });
    }

    for (const usage of extract.jsx) {
      const root = usage.name.split('.')[0] ?? usage.name;
      if (known.has(root) || imported.has(root) || definitions.has(root)) continue;
      add({
        ruleId: 'R7',
        layer: 'frontend',
        entity: normalizeEntityName(root),
        field: usage.name,
        status: severityFor('R7', 'red'),
        severity: severityFor('R7', 'red'),
        message: `[R7] Componente "<${usage.name}>" usado sem definição ou import.`,
        frontRef: { file: usage.file, line: usage.line },
        suggestion: `Defina ou importe o componente ${usage.name}.`,
      });
    }
  }

  for (const route of map.routes) {
    if (!route.component) continue;
    const root = route.component.split('.')[0] ?? route.component;
    const fileImports = map.files.find((file) => file.file === route.ref.file)?.imports ?? [];
    const imported = fileImports.some((item) => item.names.includes(root));
    if (imported || definitions.has(root)) continue;

    add({
      ruleId: 'R7',
      layer: 'frontend',
      entity: normalizeEntityName(root),
      field: root,
      status: severityFor('R7', 'red'),
      severity: severityFor('R7', 'red'),
      message: `[R7] Rota "${route.path}" referencia "${route.component}" sem definição/import.`,
      frontRef: route.ref,
      suggestion: `Importe ou defina o componente ${route.component} antes de usá-lo na rota.`,
    });
  }
}

function applyR9(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  for (const [entityName, entity] of [...map.database, ...map.backend]) {
    for (const field of entity.fields) {
      if (!looksMonetary(field.rawName) || !isFloatingPointType(field.rawType)) continue;
      add({
        ruleId: 'R9',
        layer: entity.layer,
        entity: entityName,
        field: field.name,
        status: severityFor('R9', 'yellow'),
        severity: severityFor('R9', 'yellow'),
        message: `[R9] Valor monetário "${field.rawName}" usa ${field.rawType ?? 'float'}; prefira decimal inteiro em centavos.`,
        backRef: field.ref,
        dbRef: field.ref,
        suggestion: `Troque ${field.rawType ?? 'float'} por decimal(12,2) ou armazene centavos como inteiro.`,
      });
    }
  }
}

function applyR10(
  map: ProjectMap,
  add: (finding: Finding) => void,
  severityFor: (id: BindingRuleId, fallback: BindingStatus) => BindingStatus,
): void {
  for (const extract of map.files) {
    const lower = extract.file.toLowerCase();
    const isController = /controller|resource|router/.test(lower);

    for (const item of extract.imports) {
      if (!item.relative || !item.specifier.startsWith('..')) continue;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(extract.file), item.specifier),
      );
      const fromModule = moduleOf(extract.file);
      const toModule = moduleOf(resolved);
      const directRepository =
        isController && /repositor|repository|dao|db\//i.test(item.specifier);

      if (directRepository) {
        add({
          ruleId: 'R10',
          layer: 'backend',
          entity: moduleOf(extract.file),
          field: item.specifier,
          status: severityFor('R10', 'yellow'),
          severity: severityFor('R10', 'yellow'),
          message: `[R10] Controller acessa repository/DAO diretamente: "${item.specifier}".`,
          frontRef: { file: extract.file, line: item.line },
          suggestion: 'Passe a dependência por um service e mantenha o controller fino.',
        });
      } else if (fromModule && toModule && fromModule !== toModule) {
        add({
          ruleId: 'R10',
          layer: extract.layer,
          entity: fromModule,
          field: item.specifier,
          status: severityFor('R10', 'yellow'),
          severity: severityFor('R10', 'yellow'),
          message: `[R10] Import cruzado entre módulos: "${item.specifier}" (${fromModule} → ${toModule}).`,
          frontRef: { file: extract.file, line: item.line },
          suggestion:
            'Extraia um contrato compartilhado em vez de importar direto de outro módulo.',
        });
      }
    }
  }
}

export function routeMatches(call: FrontendCall, endpoint: EndpointInfo): boolean {
  if (call.method !== endpoint.method) return false;
  for (const callPath of pathVariants(call.path)) {
    for (const endpointPath of pathVariants(endpoint.path)) {
      if (pathsMatch(callPath, endpointPath)) return true;
    }
  }
  return false;
}

export function pathsMatch(left: string, right: string): boolean {
  const a = left.split('/').filter(Boolean);
  const b = right.split('/').filter(Boolean);
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    const leftSegment = a[index] ?? '';
    const rightSegment = b[index] ?? '';
    if (leftSegment === rightSegment) continue;
    if (leftSegment.startsWith(':') || rightSegment.startsWith(':')) continue;
    if (leftSegment === '*' || rightSegment === '*') continue;
    return false;
  }
  return true;
}

function pathVariants(value: string): string[] {
  const normalized = value.startsWith('/') ? value : `/${value}`;
  const variants = new Set<string>([normalized]);

  if (normalized.startsWith('/api/v1/')) variants.add(normalized.slice('/api/v1'.length));
  if (normalized.startsWith('/api/v2/')) variants.add(normalized.slice('/api/v2'.length));
  if (normalized.startsWith('/api/')) variants.add(normalized.slice('/api'.length));
  if (normalized.startsWith('/v1/')) variants.add(normalized.slice('/v1'.length));
  if (normalized.startsWith('/v2/')) variants.add(normalized.slice('/v2'.length));

  for (const variant of [...variants]) {
    if (!variant.startsWith('/api')) variants.add(`/api${variant}`);
    if (variant.endsWith('/index')) variants.add(variant.slice(0, -'/index'.length));
    variants.add(variant.replace(/\/$/, '') || '/');
  }

  return [...variants];
}

function resolveLocalImport(
  importingFile: string,
  specifier: string,
  existing: Set<string>,
): boolean {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importingFile), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.vue`,
    `${base}.svelte`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
  return candidates.some((candidate) => existing.has(candidate));
}

function moduleOf(file: string): string {
  const segments = file.replaceAll('\\', '/').split('/').filter(Boolean);
  const srcIndex = segments.indexOf('src');
  const start = srcIndex === -1 ? 0 : srcIndex + 1;
  const a = segments[start];
  const b = segments[start + 1];
  if (!a) return '';
  if (a === 'features' || a === 'modules' || a === 'packages') return b ? `${a}/${b}` : a;
  return a;
}

function isMockOnly(map: ProjectMap, entityName: string): boolean {
  const entity = map.frontend.get(entityName);
  if (!entity) return false;
  if (map.calls.some((call) => call.entity === entityName)) return false;

  const mockRef = entity.refs.some((ref_) => map.mockFiles.has(ref_.file));
  const localRef = entity.refs.some((ref_) => map.localStorageFiles.has(ref_.file));
  return mockRef || localRef;
}

/** Tipos de UI/globais não são contratos de dados entre as camadas. */
function isIgnoredFrontEntity(entity: { name: string; rawName: string }): boolean {
  if (isAuxiliaryTypeName(entity.rawName)) return true;
  if (GLOBAL_FRONT_TYPES.has(entity.name.toLowerCase())) return true;
  return /^(props|state|config|options|params|query|result|theme|style|event)s?$/.test(
    entity.name.toLowerCase(),
  );
}

function matchesAccepted(
  accepted: string[],
  finding: Pick<Finding, 'ruleId' | 'entity' | 'field'>,
): boolean {
  for (const pattern of accepted) {
    const [rule, entity, field] = pattern.split(':');
    if (!rule || rule !== finding.ruleId) continue;
    if (entity && entity !== '*' && entity !== finding.entity) continue;
    if (field && field !== '*' && field !== finding.field) continue;
    return true;
  }
  return false;
}

/** Exposto para testes das regras. */
export function sameName(left: string, right: string): boolean {
  return normalizeFieldName(left) === normalizeFieldName(right);
}

export function sameFieldName(left: string, right: string): boolean {
  return nameSimilarity(left, right) === 1;
}

export function databaseFieldRef(
  map: ProjectMap,
  entity: string,
  field: string,
): SourceRef | undefined {
  return findDatabaseField(map, entity, field)?.field.ref;
}
