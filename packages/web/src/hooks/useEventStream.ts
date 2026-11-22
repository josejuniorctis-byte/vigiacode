import { useEffect, useRef, useState } from 'react';
import type { BindingsEvent, ChangeEvent, RoadmapEvent } from '../types';

export type StreamStatus = 'connecting' | 'live' | 'offline';

export interface EventStreamHandlers {
  onEvent?: (event: ChangeEvent) => void;
  onSummary?: (event: ChangeEvent) => void;
  onBindings?: (event: BindingsEvent) => void;
  onRoadmap?: (event: RoadmapEvent) => void;
}

type StreamMessage =
  { type: 'change' | 'summary'; event: ChangeEvent } | BindingsEvent | RoadmapEvent;

/**
 * Conecta em /api/events/stream com reconexão automática e backoff exponencial.
 * O EventSource nativo não é usado para reconectar: fechamos e recriamos para
 * controlar o backoff e o estado online/offline.
 */
export function useEventStream(handlers: EventStreamHandlers = {}): StreamStatus {
  const handlersRef = useRef(handlers);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStatus('offline');
      return undefined;
    }

    let source: EventSource | null = null;
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = (): void => {
      if (stopped) return;
      setStatus('offline');
      const delay = Math.min(15_000, 1000 * 2 ** attempts);
      attempts += 1;
      timer = setTimeout(connect, delay);
    };

    const handleMessage = (type: 'change' | 'summary') => {
      return (event: Event): void => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data) as StreamMessage;
          if (message.type !== type) return;
          const changeEvent = (message as { event: ChangeEvent }).event;
          if (type === 'change') handlersRef.current.onEvent?.(changeEvent);
          else handlersRef.current.onSummary?.(changeEvent);
        } catch {
          // Evento malformado não derruba o stream.
        }
      };
    };

    const handleBindings = (event: Event): void => {
      try {
        const message = JSON.parse((event as MessageEvent<string>).data) as StreamMessage;
        if (message.type !== 'bindings') return;
        handlersRef.current.onBindings?.(message);
      } catch {
        // Evento malformado não derruba o stream.
      }
    };

    const handleRoadmap = (event: Event): void => {
      try {
        const message = JSON.parse((event as MessageEvent<string>).data) as StreamMessage;
        if (message.type !== 'roadmap') return;
        handlersRef.current.onRoadmap?.(message);
      } catch {
        // Evento malformado não derruba o stream.
      }
    };

    function connect(): void {
      if (stopped) return;
      setStatus('connecting');

      try {
        source = new EventSource('/api/events/stream');
      } catch {
        scheduleReconnect();
        return;
      }

      source.onopen = () => {
        attempts = 0;
        setStatus('live');
      };

      source.onerror = () => {
        if (stopped) return;
        source?.close();
        source = null;
        scheduleReconnect();
      };

      source.addEventListener('change', handleMessage('change'));
      source.addEventListener('summary', handleMessage('summary'));
      source.addEventListener('bindings', handleBindings);
      source.addEventListener('roadmap', handleRoadmap);
    }

    connect();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, []);

  return status;
}
