import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BindingsEvent, ChangeEvent } from '../types';
import { useEventStream, type StreamStatus } from './useEventStream';

interface LiveEventsContextValue {
  status: StreamStatus;
  events: Record<string, ChangeEvent>;
  recentBatchIds: Set<string>;
  latestBindings: BindingsEvent | null;
}

const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);

export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<Record<string, ChangeEvent>>({});
  const [recentBatchIds, setRecentBatchIds] = useState<Set<string>>(() => new Set());
  const [latestBindings, setLatestBindings] = useState<BindingsEvent | null>(null);
  const queryClient = useQueryClient();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const status = useEventStream({
    onEvent: (event) => {
      setEvents((previous) => ({ ...previous, [event.id]: event }));

      const batchKey = event.batchId ?? event.id;
      setRecentBatchIds((previous) => {
        const next = new Set(previous);
        next.add(batchKey);
        return next;
      });

      const existingTimer = timers.current.get(batchKey);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        setRecentBatchIds((previous) => {
          const next = new Set(previous);
          next.delete(batchKey);
          return next;
        });
        timers.current.delete(batchKey);
      }, 3000);
      timers.current.set(batchKey, timer);
    },
    onSummary: (event) => {
      setEvents((previous) => ({ ...previous, [event.id]: event }));
    },
    onBindings: (payload) => {
      setLatestBindings(payload);
      void queryClient.invalidateQueries({ queryKey: ['bindings-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['bindings-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['bindings-scans'] });
      void queryClient.invalidateQueries({ queryKey: ['bindings'] });
    },
  });

  useEffect(() => {
    const scheduled = timers.current;
    return () => {
      for (const timer of scheduled.values()) clearTimeout(timer);
      scheduled.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ status, events, recentBatchIds, latestBindings }),
    [status, events, recentBatchIds, latestBindings],
  );

  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEvents(): LiveEventsContextValue {
  const context = useContext(LiveEventsContext);
  if (!context) {
    throw new Error('useLiveEvents precisa estar dentro de LiveEventsProvider.');
  }
  return context;
}
