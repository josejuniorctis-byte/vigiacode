import { describe, expect, it } from 'vitest';
import { createDefaultBindingsConfig, type BindingsConfig, type BindingRuleId } from '../config.js';
import { normalizeFieldName, normalizeType } from './names.js';
import { buildMatchContext } from './matcher.js';
import { evaluateRules, routeMatches } from './rules.js';
import {
  emptyFileExtract,
  type EntityField,
  type EntityInfo,
  type FileExtract,
  type Finding,
  type ProjectMap,
} from './types.js';

type Layer = 'frontend' | 'backend' | 'database';

function field(
  rawName: string,
  rawType: string | null = null,
  source = 'type',
  ref = { file: 'src/file.ts', line: 1 },
): EntityField {
  return {
    name: normalizeFieldName(rawName),
    rawName,
    rawType,
    type: normalizeType(rawType),
    optional: false,
    ref,
    source,
  };
}

function entity(
  layer: Layer,
  name: string,
  fields: EntityField[],
  ref = { file: 'src/file.ts', line: 1 },
): EntityInfo {
  return {
    name,
    rawName: name,
    layer,
    refs: [ref],
    fields,
    sources: layer === 'database' ? ['column'] : ['type'],
  };
}

function makeMap(input: {
  frontend?: EntityInfo[];
  backend?: EntityInfo[];
  database?: EntityInfo[];
  endpoints?: ProjectMap['endpoints'];
  calls?: ProjectMap['calls'];
  imports?: ProjectMap['imports'];
  jsx?: ProjectMap['jsx'];
  files?: FileExtract[];
  migrationColumns?: Array<[string, EntityField[]]>;
  mockFiles?: string[];
  localStorageFiles?: string[];
}): ProjectMap {
  const migrationFiles =
    input.migrationColumns && input.migrationColumns.length > 0
      ? [{ file: 'db/migrations/0000_init.sql', line: 1 }]
      : [];
  return {
    frontend: new Map((input.frontend ?? []).map((item) => [item.name, item])),
    backend: new Map((input.backend ?? []).map((item) => [item.name, item])),
    database: new Map((input.database ?? []).map((item) => [item.name, item])),
    endpoints: input.endpoints ?? [],
    calls: input.calls ?? [],
    routes: (input.files ?? []).flatMap((file) => file.routes),
    imports: input.imports ?? [],
    jsx: input.jsx ?? [],
    definitions: new Map(),
    files: input.files ?? [],
    migrationColumns: new Map(
      (input.migrationColumns ?? []).map(([name, fields]) => [
        name,
        new Map(
          fields.map((item) => [
            item.name,
            {
              name: item.name,
              rawName: item.rawName,
              rawType: item.rawType,
              ref: item.ref,
              removed: false,
            },
          ]),
        ),
      ]),
    ),
    migrationFiles,
    mockFiles: new Set(input.mockFiles ?? []),
    localStorageFiles: new Set(input.localStorageFiles ?? []),
  };
}

async function run(
  map: ProjectMap,
  config: BindingsConfig = createDefaultBindingsConfig(),
): Promise<Finding[]> {
  const context = await buildMatchContext(map, { semanticMatching: true });
  return evaluateRules(map, context, config);
}

function find(findings: Finding[], ruleId: string, entityName: string, fieldName: string) {
  return findings.find(
    (finding) =>
      finding.ruleId === ruleId && finding.entity === entityName && finding.field === fieldName,
  );
}

function configWith(
  id: BindingRuleId,
  overrides: { enabled?: boolean; severity?: 'red' | 'yellow' },
): BindingsConfig {
  const config = createDefaultBindingsConfig();
  config.rules[id] = {
    enabled: overrides.enabled ?? config.rules[id].enabled,
    severity: overrides.severity ?? config.rules[id].severity,
  };
  return config;
}

describe('regras do detector', () => {
  it('R1: campo do front sem campo no back; e GREEN quando as três camadas batem', async () => {
    const map = makeMap({
      frontend: [entity('frontend', 'user', [field('name'), field('phone')])],
      backend: [entity('backend', 'user', [field('name')])],
      database: [entity('database', 'user', [field('name')])],
    });

    const findings = await run(map);

    expect(find(findings, 'R1', 'user', 'phone')).toMatchObject({
      status: 'red',
      layer: 'backend',
      message: expect.stringContaining('phone'),
    });
    expect(find(findings, 'GREEN', 'user', 'name')).toMatchObject({
      status: 'green',
      frontRef: expect.anything(),
      backRef: expect.anything(),
      dbRef: expect.anything(),
    });
  });

  it('R2: campo do DTO sem coluna (red) e tipo divergente (yellow)', async () => {
    const map = makeMap({
      backend: [
        entity('backend', 'user', [
          field('name', 'string', 'dto'),
          field('age', 'number', 'dto'),
          field('nickname', 'string', 'dto'),
        ]),
      ],
      database: [
        entity('database', 'user', [
          field('name', 'text', 'column'),
          field('age', 'text', 'column'),
        ]),
      ],
    });

    const findings = await run(map);

    expect(find(findings, 'R2', 'user', 'nickname')?.status).toBe('red');
    expect(find(findings, 'R2', 'user', 'age')?.status).toBe('yellow');
    expect(find(findings, 'R2', 'user', 'age')?.message).toContain('Tipo divergente');
  });

  it('R3: coluna sem migration e migration sem schema', async () => {
    const map = makeMap({
      database: [
        entity('database', 'user', [
          field('name', 'text', 'column'),
          field('legacy', 'text', 'column'),
        ]),
      ],
      migrationColumns: [
        ['user', [field('name', 'text', 'migration'), field('obsolete', 'text', 'migration')]],
      ],
    });

    const findings = await run(map);

    expect(find(findings, 'R3', 'user', 'legacy')?.status).toBe('yellow');
    expect(find(findings, 'R3', 'user', 'obsolete')?.status).toBe('yellow');
    expect(find(findings, 'R3', 'user', 'name')).toBeUndefined();
  });

  it('R4 e R5: rota inexistente e endpoint sem consumidor', async () => {
    const map = makeMap({
      calls: [
        {
          method: 'GET',
          path: '/api/orders',
          rawPath: '/api/orders',
          entity: 'order',
          ref: { file: 'src/pages/Orders.tsx', line: 3 },
          source: 'fetch',
        },
      ],
      endpoints: [
        {
          method: 'GET',
          path: '/api/users',
          rawPath: '/api/users',
          entity: 'user',
          ref: { file: 'server/routes/users.ts', line: 10 },
          source: 'fastify',
        },
      ],
    });

    const findings = await run(map);

    expect(find(findings, 'R4', 'order', 'GET /api/orders')?.status).toBe('red');
    expect(find(findings, 'R5', 'user', 'GET /api/users')?.status).toBe('yellow');
  });

  it('R6: entidade com API sem tela e tela só com mock/localStorage', async () => {
    const backend = entity('backend', 'customer', [], {
      file: 'server/routes/customers.ts',
      line: 5,
    });
    const mockPage = emptyFileExtract('src/mocks/customers.ts', 'frontend', 'frontend');
    mockPage.mockFile = true;
    const map = makeMap({
      backend: [backend],
      endpoints: [
        {
          method: 'GET',
          path: '/api/customers',
          rawPath: '/api/customers',
          entity: 'customer',
          ref: { file: 'server/routes/customers.ts', line: 5 },
          source: 'fastify',
        },
      ],
      files: [mockPage],
    });

    const findings = await run(map);
    expect(find(findings, 'R6', 'customer', '*')?.message).toContain('nenhuma tela');

    const localMap = makeMap({
      frontend: [
        entity('frontend', 'customer', [field('name')], {
          file: 'src/mocks/customers.ts',
          line: 1,
        }),
      ],
      backend: [backend],
      endpoints: map.endpoints,
      mockFiles: ['src/mocks/customers.ts'],
      files: [mockPage],
    });
    const localFindings = await run(localMap);
    expect(find(localFindings, 'R6', 'customer', '*')?.message).toContain('mock/localStorage');
  });

  it('R7: import relativo e componente JSX sem definição', async () => {
    const page = emptyFileExtract('src/pages/UsersPage.tsx', 'frontend', 'frontend');
    page.imports.push({
      file: 'src/pages/UsersPage.tsx',
      line: 2,
      specifier: '../components/MissingPanel',
      names: ['MissingPanel'],
      relative: true,
    });
    page.jsx.push({ file: 'src/pages/UsersPage.tsx', line: 9, name: 'UnknownPanel' });
    page.routes.push({
      path: '/users',
      component: 'UnknownRoute',
      ref: { file: 'src/pages/UsersPage.tsx', line: 10 },
    });

    const findings = await run(makeMap({ files: [page] }));

    expect(find(findings, 'R7', 'missing_panel', '../components/MissingPanel')?.status).toBe('red');
    expect(find(findings, 'R7', 'unknown_panel', 'UnknownPanel')?.status).toBe('red');
    expect(find(findings, 'R7', 'unknown_route', 'UnknownRoute')?.status).toBe('red');
  });

  it('normaliza parâmetros e prefixos de rota no matching R4/R5', () => {
    const call = {
      method: 'GET' as const,
      path: '/api/users/:param',
      rawPath: '/api/users/42',
      entity: 'user',
      ref: { file: 'src/pages/UsersPage.tsx', line: 5 },
      source: 'fetch',
    };
    const endpoint = {
      method: 'GET' as const,
      path: '/users/:id',
      rawPath: '/users/:id',
      entity: 'user',
      ref: { file: 'server/routes/users.ts', line: 5 },
      source: 'fastify',
    };

    expect(routeMatches(call, endpoint)).toBe(true);
  });

  it('R8: nome parecido sem ligação em vez de R1', async () => {
    const map = makeMap({
      frontend: [entity('frontend', 'user', [field('displayName')])],
      backend: [entity('backend', 'user', [field('name', 'string', 'dto')])],
      database: [entity('database', 'user', [field('name', 'text', 'column')])],
    });

    const findings = await run(map);

    expect(find(findings, 'R8', 'user', 'display_name')?.status).toBe('yellow');
    expect(find(findings, 'R1', 'user', 'display_name')).toBeUndefined();
  });

  it('R9 fica desligada por padrão e pode ser ligada', async () => {
    const map = makeMap({
      backend: [entity('backend', 'product', [field('price', 'number', 'dto')])],
      database: [entity('database', 'product', [field('price', 'double', 'column')])],
    });

    expect((await run(map)).some((finding) => finding.ruleId === 'R9')).toBe(false);

    const findings = await run(map, configWith('R9', { enabled: true }));
    expect(find(findings, 'R9', 'product', 'price')?.status).toBe('yellow');
  });

  it('R10 é configurável e detecta controller acessando repository', async () => {
    const controller = emptyFileExtract(
      'src/modules/users/users.controller.ts',
      'backend',
      'backend',
    );
    controller.imports.push({
      file: 'src/modules/users/users.controller.ts',
      line: 3,
      specifier: '../../repositories/user-repository',
      names: ['UserRepository'],
      relative: true,
    });

    const map = makeMap({ files: [controller] });
    expect((await run(map)).some((finding) => finding.ruleId === 'R10')).toBe(false);

    const findings = await run(map, configWith('R10', { enabled: true }));
    expect(
      find(findings, 'R10', 'modules/users', '../../repositories/user-repository'),
    ).toBeDefined();
  });

  it('respeita severidade configurada, desligamento e falsos positivos aceitos', async () => {
    const map = makeMap({
      frontend: [entity('frontend', 'user', [field('phone')])],
      backend: [entity('backend', 'user', [field('name')])],
      database: [entity('database', 'user', [field('name')])],
    });

    const yellow = await run(map, configWith('R1', { severity: 'yellow' }));
    expect(find(yellow, 'R1', 'user', 'phone')?.status).toBe('yellow');

    const disabled = await run(map, configWith('R1', { enabled: false }));
    expect(find(disabled, 'R1', 'user', 'phone')).toBeUndefined();

    const accepted = createDefaultBindingsConfig();
    accepted.acceptedFalsePositives.push('R1:user:phone');
    expect(find(await run(map, accepted), 'R1', 'user', 'phone')).toBeUndefined();
  });
});
