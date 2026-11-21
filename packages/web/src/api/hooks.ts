import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptBinding,
  explainBinding,
  fetchAiStatus,
  fetchBindingScans,
  fetchBindings,
  fetchBindingsMatrix,
  fetchBindingsSummary,
  fetchConfig,
  fetchEventDetail,
  fetchEvents,
  fetchFileEvents,
  fetchHealth,
  fetchProject,
  fetchSnapshots,
  fetchStats,
  scanBindings,
} from './client';
import type { BindingsFilters, TimelineFilters } from '../types';

export const queryKeys = {
  project: ['project'] as const,
  health: ['health'] as const,
  aiStatus: ['ai-status'] as const,
  snapshots: ['snapshots'] as const,
  stats: ['stats'] as const,
  config: ['config'] as const,
  events: (filters: TimelineFilters) => ['events', filters] as const,
  event: (id: string) => ['event', id] as const,
  fileEvents: (path: string) => ['file-events', path] as const,
  bindings: (filters: BindingsFilters) => ['bindings', filters] as const,
  bindingsSummary: ['bindings-summary'] as const,
  bindingsMatrix: ['bindings-matrix'] as const,
  bindingScans: ['bindings-scans'] as const,
};

export function useProject() {
  return useQuery({
    queryKey: queryKeys.project,
    queryFn: fetchProject,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useAiStatus() {
  return useQuery({
    queryKey: queryKeys.aiStatus,
    queryFn: fetchAiStatus,
    refetchInterval: 15_000,
  });
}

export function useSnapshots() {
  return useQuery({
    queryKey: queryKeys.snapshots,
    queryFn: fetchSnapshots,
    staleTime: 30_000,
  });
}

export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: fetchStats,
    staleTime: 10_000,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: fetchConfig,
    staleTime: 30_000,
  });
}

export function useInfiniteEvents(filters: TimelineFilters, limit = 100) {
  return useInfiniteQuery({
    queryKey: queryKeys.events(filters),
    queryFn: ({ pageParam }) => fetchEvents(filters, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.events.length > 0 ? lastPage.events[lastPage.events.length - 1]?.id : undefined,
  });
}

export function useEventDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.event(id ?? ''),
    queryFn: () => fetchEventDetail(id ?? ''),
    enabled: Boolean(id),
  });
}

export function useFileEvents(filePath: string | null) {
  return useQuery({
    queryKey: queryKeys.fileEvents(filePath ?? ''),
    queryFn: () => fetchFileEvents(filePath ?? ''),
    enabled: Boolean(filePath),
  });
}

export function useBindings(filters: BindingsFilters) {
  return useQuery({
    queryKey: queryKeys.bindings(filters),
    queryFn: () => fetchBindings(filters),
    staleTime: 5_000,
  });
}

export function useBindingsSummary() {
  return useQuery({
    queryKey: queryKeys.bindingsSummary,
    queryFn: fetchBindingsSummary,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useBindingsMatrix() {
  return useQuery({
    queryKey: queryKeys.bindingsMatrix,
    queryFn: fetchBindingsMatrix,
    staleTime: 10_000,
  });
}

export function useBindingScans() {
  return useQuery({
    queryKey: queryKeys.bindingScans,
    queryFn: fetchBindingScans,
    staleTime: 10_000,
  });
}

export function useScanBindings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: scanBindings,
    onSuccess: () => invalidateBindings(queryClient),
  });
}

export function useAcceptBinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptBinding,
    onSuccess: () => invalidateBindings(queryClient),
  });
}

export function useExplainBinding() {
  return useMutation({ mutationFn: explainBinding });
}

function invalidateBindings(queryClient: ReturnType<typeof useQueryClient>): void {
  for (const key of [
    queryKeys.bindingsSummary,
    queryKeys.bindingsMatrix,
    queryKeys.bindingScans,
  ] as const) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
  void queryClient.invalidateQueries({ queryKey: ['bindings'] });
}
