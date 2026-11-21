import type {
  AiStatus,
  AiTestResult,
  AppConfig,
  BindingExplanation,
  BindingMatrix,
  BindingScan,
  BindingsFilters,
  BindingsResponse,
  BindingSummary,
  ChangeEventDetail,
  EventsResponse,
  FileEventsResponse,
  HealthResponse,
  Project,
  ProjectStats,
  SnapshotsResponse,
  TimelineFilters,
} from '../types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  if (!response.ok) {
    let message = `Erro HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Mantém a mensagem padrão.
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

export function fetchProject(): Promise<Project> {
  return request<Project>('/api/project');
}

export function fetchAiStatus(): Promise<AiStatus> {
  return request<AiStatus>('/api/ai/status');
}

export function fetchSnapshots(): Promise<SnapshotsResponse> {
  return request<SnapshotsResponse>('/api/snapshots');
}

export function fetchStats(): Promise<ProjectStats> {
  return request<ProjectStats>('/api/stats');
}

export function fetchConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/config');
}

export function fetchEventDetail(id: string): Promise<ChangeEventDetail> {
  return request<ChangeEventDetail>(`/api/events/${encodeURIComponent(id)}`);
}

export function fetchFileEvents(filePath: string, before?: string): Promise<FileEventsResponse> {
  const params = new URLSearchParams({ path: filePath, limit: '100' });
  if (before) params.set('before', before);
  return request<FileEventsResponse>(`/api/files/events?${params.toString()}`);
}

export function fetchEvents(
  filters: TimelineFilters,
  before?: string,
  limit = 100,
): Promise<EventsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  if (filters.layer !== 'all') params.set('layer', filters.layer);
  if (filters.q.trim().length > 0) params.set('q', filters.q.trim());

  const from = periodStart(filters.period);
  if (from) params.set('from', from);

  return request<EventsResponse>(`/api/events?${params.toString()}`);
}

export function testAi(): Promise<AiTestResult> {
  return request<AiTestResult>('/api/ai/test', { method: 'POST' });
}

export function fetchBindings(filters: BindingsFilters): Promise<BindingsResponse> {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.layer !== 'all') params.set('layer', filters.layer);
  if (filters.rule !== 'all') params.set('rule', filters.rule);
  if (filters.entity.trim().length > 0) params.set('entity', filters.entity.trim());
  if (filters.q.trim().length > 0) params.set('q', filters.q.trim());
  if (filters.includeResolved) params.set('includeResolved', 'true');
  const query = params.toString();
  return request<BindingsResponse>(`/api/bindings${query.length > 0 ? `?${query}` : ''}`);
}

export function fetchBindingsSummary(): Promise<BindingSummary> {
  return request<BindingSummary>('/api/bindings/summary');
}

export function fetchBindingsMatrix(): Promise<BindingMatrix> {
  return request<BindingMatrix>('/api/bindings/matrix');
}

export function fetchBindingScans(): Promise<{ scans: BindingScan[] }> {
  return request<{ scans: BindingScan[] }>('/api/bindings/scans?limit=50');
}

export function scanBindings(): Promise<{ skipped?: boolean } | unknown> {
  return request<unknown>('/api/bindings/scan', { method: 'POST' });
}

export function acceptBinding(id: string): Promise<unknown> {
  return request<unknown>(`/api/bindings/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

export function explainBinding(id: string): Promise<BindingExplanation> {
  return request<BindingExplanation>(`/api/bindings/${encodeURIComponent(id)}/explain`, {
    method: 'POST',
  });
}

export function periodStart(period: TimelineFilters['period']): string | null {
  if (period === 'all') return null;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const offset = period === '24h' ? day : period === '7d' ? 7 * day : 30 * day;
  return new Date(now - offset).toISOString();
}
