import type {
  AiStatus,
  Binding,
  BindingMatrix,
  BindingScan,
  BindingSummary,
  ChangeEvent,
  Project,
  Snapshot,
} from '../types';

export const projectFixture: Project = {
  id: 'p1',
  name: 'projeto-teste',
  rootPath: '/tmp/projeto-teste',
  createdAt: '2026-01-01T00:00:00.000Z',
  branch: 'main',
  commitHash: 'abcdef1234567890',
};

export const aiStatusFixture: AiStatus = {
  provider: 'ollama',
  model: 'llama3.2',
  keyPresent: true,
  lastHealthCheck: { ok: true, checkedAt: '2026-01-01T00:00:00.000Z' },
};

export const snapshotsFixture: Snapshot[] = [
  {
    id: 's1',
    projectId: 'p1',
    commitHash: 'abcdef1234567890',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export function eventFixture(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: 'e1',
    projectId: 'p1',
    filePath: 'src/api/users.ts',
    changeType: 'change',
    layer: 'backend',
    batchId: 'b1',
    summary: 'Ajustou a API de usuários.',
    createdAt: '2026-01-01T00:00:00.000Z',
    additions: 4,
    deletions: 1,
    diffTruncated: false,
    ...overrides,
  };
}

export function bindingFixture(overrides: Partial<Binding> = {}): Binding {
  return {
    id: 'b1',
    projectId: 'p1',
    ruleId: 'R1',
    layer: 'backend',
    entity: 'user',
    field: 'phone',
    status: 'red',
    severity: 'red',
    message: '[R1] Campo "phone" usado no front-end não existe no DTO/rota de "user".',
    frontRef: 'src/pages/UsersPage.tsx:14',
    backRef: 'server/routes/users.ts:5',
    dbRef: null,
    suggestion: 'Adicione phone ao DTO.',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    accepted: false,
    ...overrides,
  };
}

export const bindingSummaryFixture: BindingSummary = {
  red: 1,
  yellow: 2,
  green: 5,
  total: 8,
  active: 8,
  resolved: 0,
  accepted: 0,
  healthPercent: 62,
  byRule: [
    { ruleId: 'R1', red: 1, yellow: 0, green: 0 },
    { ruleId: 'GREEN', red: 0, yellow: 0, green: 5 },
  ],
  byLayer: [
    { layer: 'backend', red: 1, yellow: 0, green: 5 },
    { layer: 'database', red: 0, yellow: 2, green: 0 },
  ],
  lastScan: null,
};

export const bindingScanFixture: BindingScan = {
  id: 'scan-1',
  projectId: 'p1',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  filesScanned: 9,
  redCount: 1,
  yellowCount: 2,
  greenCount: 5,
  createdCount: 3,
  resolvedCount: 1,
  trigger: 'watch',
  batchId: 'b1',
  matrixJson: null,
  error: null,
};

export const bindingMatrixFixture: BindingMatrix = {
  generatedAt: '2026-01-01T00:00:01.000Z',
  scanId: 'scan-1',
  entities: [
    {
      entity: 'user',
      rawName: 'User',
      front: { state: 'integrated', fields: 4, ref: 'src/types/user.ts:1' },
      back: { state: 'integrated', fields: 4, ref: 'server/routes/users.ts:3' },
      db: { state: 'integrated', fields: 4, ref: 'db/schema.ts:3' },
      status: 'yellow',
      link: 'partial',
      pending: 1,
      missing: [],
    },
    {
      entity: 'customer',
      rawName: 'Customer',
      front: { state: 'local', fields: 3, ref: 'src/mocks/customers.ts:1' },
      back: { state: 'missing', fields: 0, ref: null },
      db: { state: 'missing', fields: 0, ref: null },
      status: 'red',
      link: 'link',
      pending: 0,
      missing: ['backend', 'database'],
    },
  ],
  totals: { entities: 2, integrated: 0, partial: 1, local: 0, missing: 1 },
};

export function batchEvents(): ChangeEvent[] {
  return [
    eventFixture({ id: 'e1', filePath: 'src/api/users.ts', batchId: 'b1' }),
    eventFixture({
      id: 'e2',
      filePath: 'src/components/Button.tsx',
      batchId: 'b1',
      layer: 'frontend',
      summary: 'Ajustou a API de usuários.',
      additions: 2,
      deletions: 0,
    }),
    eventFixture({
      id: 'e3',
      filePath: 'db/schema.sql',
      batchId: 'b2',
      layer: 'database',
      summary: null,
      createdAt: '2026-01-01T00:05:00.000Z',
      additions: 1,
      deletions: 0,
    }),
  ];
}
