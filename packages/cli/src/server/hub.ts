import type { ChangeEvent, ChangeEventLayer, ChangeType } from '../db/schema.js';

/** Evento sem o diff, usado em listagens e no stream SSE. */
export interface PublicChangeEvent {
  id: string;
  projectId: string;
  filePath: string;
  changeType: ChangeType;
  layer: ChangeEventLayer;
  batchId: string | null;
  summary: string | null;
  createdAt: string;
}

export interface ChangeStreamMessage {
  type: 'change';
  event: PublicChangeEvent;
}

export interface SummaryStreamMessage {
  type: 'summary';
  event: PublicChangeEvent;
}

export type EventStreamMessage = ChangeStreamMessage | SummaryStreamMessage;

export type EventStreamListener = (message: EventStreamMessage) => void;

/**
 * Hub em memória para o SSE (`/api/events/stream`).
 * O recorder publica; cada conexão aberta recebe os eventos em tempo real.
 */
export class EventHub {
  private readonly listeners = new Set<EventStreamListener>();

  get subscriberCount(): number {
    return this.listeners.size;
  }

  subscribe(listener: EventStreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(message: EventStreamMessage): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(message);
      } catch {
        // Um cliente quebrado não pode derrubar o vigia.
      }
    }
  }
}

export function toPublicEvent(event: ChangeEvent): PublicChangeEvent {
  return {
    id: event.id,
    projectId: event.projectId,
    filePath: event.filePath,
    changeType: event.changeType,
    layer: event.layer,
    batchId: event.batchId,
    summary: event.summary,
    createdAt: event.createdAt,
  };
}
