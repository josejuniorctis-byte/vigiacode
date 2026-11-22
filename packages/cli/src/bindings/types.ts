import type { BindingProfile, BindingRuleId } from '../config.js';
import type { BindingLayer, BindingScan, BindingStatus } from '../db/schema.js';
import type { BindingSummary } from '../db/bindings-repository.js';
import type { NormalizedType } from './names.js';

/** Regras de detecção (R1..R10) + a amarração saudável (GREEN). */
export type FindingRuleId = BindingRuleId | 'GREEN';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface SourceRef {
  file: string;
  line: number;
}

export interface EntityField {
  /** Nome canônico (camel/snake/Pascal normalizados). */
  name: string;
  rawName: string;
  rawType: string | null;
  type: NormalizedType;
  optional: boolean;
  ref: SourceRef;
  /** type | form | payload | dto | entity | column | migration */
  source: string;
}

export interface EntityInfo {
  /** Nome canônico da entidade. */
  name: string;
  rawName: string;
  layer: BindingLayer;
  refs: SourceRef[];
  fields: EntityField[];
  sources: string[];
}

export interface EndpointInfo {
  method: HttpMethod;
  /** Rota normalizada, com parâmetros como :id. */
  path: string;
  rawPath: string;
  entity: string;
  ref: SourceRef;
  /** express | fastify | nest | next | spring | fastapi */
  source: string;
}

export interface FrontendCall {
  method: HttpMethod;
  path: string;
  rawPath: string;
  entity: string;
  ref: SourceRef;
  /** fetch | axios | ky | http */
  source: string;
}

export interface RouteInfo {
  path: string;
  component: string | null;
  ref: SourceRef;
}

export interface ImportRef {
  file: string;
  line: number;
  specifier: string;
  names: string[];
  relative: boolean;
}

export interface JsxUsage {
  file: string;
  line: number;
  name: string;
}

export interface MigrationField {
  name: string;
  rawName: string;
  rawType: string | null;
  ref: SourceRef;
  removed: boolean;
}

export interface MigrationTable {
  entity: string;
  rawName: string;
  fields: MigrationField[];
}

/** Resultado da extração de um arquivo para UMA camada. */
export interface FileExtract {
  file: string;
  layer: BindingLayer;
  extractor: string;
  entities: EntityInfo[];
  endpoints: EndpointInfo[];
  calls: FrontendCall[];
  routes: RouteInfo[];
  imports: ImportRef[];
  jsx: JsxUsage[];
  definitions: string[];
  /** Tabelas/colunas vistas em migrations SQL (para a regra R3). */
  migrations: MigrationTable[];
  mockFile: boolean;
  localStorage: boolean;
  errors: string[];
}

export interface ProjectMap {
  frontend: Map<string, EntityInfo>;
  backend: Map<string, EntityInfo>;
  database: Map<string, EntityInfo>;
  endpoints: EndpointInfo[];
  calls: FrontendCall[];
  routes: RouteInfo[];
  imports: ImportRef[];
  jsx: JsxUsage[];
  definitions: Map<string, SourceRef[]>;
  files: FileExtract[];
  /** Colunas vistas em migrations SQL: entidade → campo → definição. */
  migrationColumns: Map<string, Map<string, MigrationField>>;
  migrationFiles: SourceRef[];
  mockFiles: Set<string>;
  localStorageFiles: Set<string>;
}

export interface Finding {
  ruleId: FindingRuleId;
  layer: BindingLayer;
  entity: string;
  field: string;
  status: BindingStatus;
  severity: BindingStatus;
  message: string;
  frontRef?: SourceRef;
  backRef?: SourceRef;
  dbRef?: SourceRef;
  suggestion?: string;
}

/** Cobertura de uma regra em um scan: avaliáveis × ignoradas + resultados. */
export interface RuleCoverage {
  ruleId: FindingRuleId;
  enabled: boolean;
  evaluated: number;
  ignored: number;
  red: number;
  yellow: number;
  green: number;
  /** Motivo quando a regra foi desligada por perfil/config. */
  note: string | null;
}

/** Relatório de cobertura congelado no scan. */
export interface BindingCoverageReport {
  profile: BindingProfile;
  typedHttpClient: boolean;
  rules: RuleCoverage[];
}

export type MatrixCellState = 'integrated' | 'partial' | 'local' | 'missing' | 'empty';
export type MatrixLink = 'integrated' | 'partial' | 'local' | 'missing' | 'link';

export interface MatrixCell {
  state: MatrixCellState;
  fields: number;
  ref: string | null;
}

export interface MatrixRow {
  entity: string;
  rawName: string;
  front: MatrixCell;
  back: MatrixCell;
  db: MatrixCell;
  status: BindingStatus;
  /** Visão resumida usada pelos ícones do dashboard. */
  link: MatrixLink;
  pending: number;
  missing: BindingLayer[];
}

export interface BindingMatrix {
  generatedAt: string;
  scanId: string | null;
  entities: MatrixRow[];
  totals: {
    entities: number;
    integrated: number;
    partial: number;
    local: number;
    missing: number;
  };
}

export interface BindingsScanResult {
  scan: BindingScan;
  summary: BindingSummary;
  created: ScanBindingView[];
  resolved: ScanBindingView[];
  matrix: BindingMatrix;
  filesScanned: number;
  trigger: 'manual' | 'watch' | 'start';
  batchId: string | null;
}

/** Visão pública da amarração usada no SSE e nas respostas da API. */
export interface ScanBindingView {
  id: string;
  projectId: string;
  ruleId: string;
  layer: BindingLayer;
  entity: string;
  field: string;
  status: BindingStatus;
  severity: BindingStatus;
  message: string;
  frontRef: string | null;
  backRef: string | null;
  dbRef: string | null;
  suggestion: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  accepted: boolean;
}

export interface BindingsStreamMessage {
  type: 'bindings';
  scanId: string;
  trigger: 'manual' | 'watch' | 'start';
  batchId: string | null;
  counts: { red: number; yellow: number; green: number };
  created: ScanBindingView[];
  resolved: ScanBindingView[];
  summary: BindingSummary;
}

export interface BindingExplanation {
  bindingId: string;
  provider: string;
  model: string | null;
  heuristic: boolean;
  explanation: string;
  suggestion: string;
}

export interface ExtractContext {
  projectRoot: string;
  /** Caminho relativo em formato POSIX. */
  file: string;
  content: string;
}

export interface LayerExtractor {
  readonly name: string;
  readonly layer: BindingLayer;
  supports(file: string, content: string): boolean;
  extract(context: ExtractContext): FileExtract;
}

export function formatRef(ref: SourceRef | null | undefined): string | null {
  return ref ? `${ref.file}:${ref.line}` : null;
}

export function emptyFileExtract(
  file: string,
  layer: BindingLayer,
  extractor: string,
): FileExtract {
  return {
    file,
    layer,
    extractor,
    entities: [],
    endpoints: [],
    calls: [],
    routes: [],
    imports: [],
    jsx: [],
    definitions: [],
    migrations: [],
    mockFile: false,
    localStorage: false,
    errors: [],
  };
}
