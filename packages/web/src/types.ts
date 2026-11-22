export const LAYERS = ['frontend', 'backend', 'database', 'config', 'other'] as const;
export type Layer = (typeof LAYERS)[number];

export type ChangeType = 'add' | 'change' | 'unlink';

export interface ChangeEvent {
  id: string;
  projectId: string;
  filePath: string;
  changeType: ChangeType;
  layer: Layer;
  batchId: string | null;
  summary: string | null;
  createdAt: string;
  additions: number;
  deletions: number;
  diffTruncated: boolean;
}

export interface ChangeEventDetail extends ChangeEvent {
  diff: string;
}

export interface Batch {
  id: string;
  createdAt: string;
  events: ChangeEvent[];
  layers: Layer[];
  fileCount: number;
  additions: number;
  deletions: number;
  summary: string | null;
  summaryPending: boolean;
}

export interface BindingDelta {
  created: number;
  resolved: number;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  branch: string | null;
  commitHash: string | null;
}

export interface HealthResponse {
  status: string;
  version: string;
}

export interface AiHealthCheck {
  ok: boolean;
  checkedAt: string;
}

export interface AiStatus {
  provider: string;
  model: string | null;
  keyPresent: boolean;
  lastHealthCheck: AiHealthCheck | null;
}

export interface Snapshot {
  id: string;
  projectId: string;
  commitHash: string;
  createdAt: string;
}

export interface StatsDay {
  date: string;
  events: number;
  files: number;
  batches: number;
  layers: Partial<Record<Layer, number>>;
}

export interface StatsFile {
  filePath: string;
  layer: Layer;
  events: number;
  lastSummary: string | null;
  lastChangedAt: string;
}

export interface ProjectStats {
  totalEvents: number;
  totalBatches: number;
  totalFiles: number;
  byDay: StatsDay[];
  byLayer: Array<{ layer: Layer; events: number }>;
  topFiles: StatsFile[];
}

export interface AppConfig {
  project: { name: string; rootPath: string };
  watch: {
    paths: string[];
    ignore: string[];
    debounceMs: number;
    maxFileSizeKb: number;
  };
  git: { maxDiffKb: number };
  llm: {
    provider: string;
    model: string | null;
    baseUrl: string | null;
    timeoutMs: number;
    maxTokens: number | null;
    temperature: number | null;
    fallbackProviders: string[];
  };
  server: { host: string; port: number };
  database: { dialect: string; file: string };
}

export interface AiTestResult {
  ok: boolean;
  provider: string;
  model: string | null;
  elapsedMs: number;
  response?: string;
  error?: string;
}

export interface EventsResponse {
  events: ChangeEvent[];
}

export interface FileEventsResponse {
  filePath: string;
  events: ChangeEvent[];
}

export interface SnapshotsResponse {
  snapshots: Snapshot[];
}

export interface TimelineFilters {
  layer: Layer | 'all';
  q: string;
  period: 'all' | '24h' | '7d' | '30d';
}

export const EMPTY_FILTERS: TimelineFilters = { layer: 'all', q: '', period: 'all' };

// ---------------------------------------------------------------------------
// Detector de amarrações (Etapa 4)
// ---------------------------------------------------------------------------

export type BindingStatus = 'red' | 'yellow' | 'green';
export type BindingLayerName = 'frontend' | 'backend' | 'database';
export type BindingScanTrigger = 'manual' | 'watch' | 'start';

export interface Binding {
  id: string;
  projectId: string;
  ruleId: string;
  layer: BindingLayerName;
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

export interface BindingScan {
  id: string;
  projectId: string;
  startedAt: string;
  finishedAt: string | null;
  filesScanned: number;
  redCount: number;
  yellowCount: number;
  greenCount: number;
  createdCount: number;
  resolvedCount: number;
  trigger: BindingScanTrigger;
  batchId: string | null;
  matrixJson: string | null;
  error: string | null;
}

export interface BindingRuleCount {
  ruleId: string;
  red: number;
  yellow: number;
  green: number;
}

export interface BindingLayerCount {
  layer: BindingLayerName;
  red: number;
  yellow: number;
  green: number;
}

export interface RuleCoverage {
  ruleId: string;
  enabled: boolean;
  evaluated: number;
  ignored: number;
  red: number;
  yellow: number;
  green: number;
  note: string | null;
}

export interface BindingSummary {
  red: number;
  yellow: number;
  green: number;
  total: number;
  active: number;
  resolved: number;
  accepted: number;
  healthPercent: number;
  weightedHealthPercent: number;
  fieldHealthPercent: number;
  byRule: BindingRuleCount[];
  byLayer: BindingLayerCount[];
  coverage: RuleCoverage[];
  profile: string | null;
  lastScan: BindingScan | null;
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
  link: MatrixLink;
  pending: number;
  missing: BindingLayerName[];
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

export interface BindingsResponse {
  bindings: Binding[];
}

export interface BindingScansResponse {
  scans: BindingScan[];
}

export interface BindingExplanation {
  bindingId: string;
  provider: string;
  model: string | null;
  heuristic: boolean;
  explanation: string;
  suggestion: string;
}

export interface BindingsEvent {
  type: 'bindings';
  scanId: string;
  trigger: BindingScanTrigger;
  batchId: string | null;
  counts: { red: number; yellow: number; green: number };
  created: Binding[];
  resolved: Binding[];
  summary: BindingSummary;
}

export interface BindingsFilters {
  status: BindingStatus | 'all';
  layer: BindingLayerName | 'all';
  rule: string | 'all';
  entity: string;
  q: string;
  includeResolved: boolean;
}

export const EMPTY_BINDING_FILTERS: BindingsFilters = {
  status: 'all',
  layer: 'all',
  rule: 'all',
  entity: '',
  q: '',
  includeResolved: false,
};

// ---------------------------------------------------------------------------
// Arquiteto — roadmap vivo (Etapa 5)
// ---------------------------------------------------------------------------

export type RoadmapStatus = 'todo' | 'doing' | 'done' | 'blocked';
export type RoadmapKind = 'feature' | 'fix' | 'debt' | 'binding' | 'test' | 'doc';
export type RoadmapPriority = 'p0' | 'p1' | 'p2' | 'p3';
export type RoadmapSource = 'manual' | 'binding' | 'git' | 'ai' | 'todo-comment';

export interface RoadmapChecklistEntry {
  label: string;
  done: boolean;
  evidence?: string | null;
}

export interface RoadmapLink {
  bindingId: string | null;
  filePath: string | null;
  commitSha: string | null;
}

export interface RoadmapItem {
  id: string;
  projectId: string;
  title: string;
  description: string;
  kind: RoadmapKind;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  source: RoadmapSource;
  sourceRef: string | null;
  module: string | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  evidence: string[];
  checklist: RoadmapChecklistEntry[];
  links: RoadmapLink[];
}

export type RoadmapCounts = Record<RoadmapStatus, number>;

export interface RoadmapResponse {
  items: RoadmapItem[];
  counts: RoadmapCounts;
  next: RoadmapItem[];
}

export interface RoadmapEvent {
  type: 'roadmap';
  scanId: string | null;
  created: number;
  reopened: number;
  closed: number;
  counts: RoadmapCounts;
  items: RoadmapItem[];
}

export interface RoadmapFilters {
  status: RoadmapStatus | 'all';
  kind: RoadmapKind | 'all';
  priority: RoadmapPriority | 'all';
  module: string;
  q: string;
}

export const EMPTY_ROADMAP_FILTERS: RoadmapFilters = {
  status: 'all',
  kind: 'all',
  priority: 'all',
  module: '',
  q: '',
};

export interface RoadmapPatch {
  status?: RoadmapStatus;
  priority?: RoadmapPriority;
  kind?: RoadmapKind;
  title?: string;
  description?: string;
  module?: string | null;
  checklist?: RoadmapChecklistEntry[];
}

export interface ArchitectPlanResult {
  provider: string;
  heuristic: boolean;
  objective: string;
  items: RoadmapItem[];
}
