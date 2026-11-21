import { randomUUID } from 'node:crypto';
import type { CodeAnchorConfig } from '../config.js';
import {
  insertChangeEvents,
  updateChangeEventSummary,
  type ChangeEvent,
  type ChangeEventLayer,
  type CodeAnchorDatabase,
  type Project,
} from '../db/index.js';
import { syncSnapshot, type GitDiff, type GitRepository } from '../git/index.js';
import {
  SummaryQueue,
  summarizeHeuristic,
  uniqueLayers,
  type Summarizer,
  type SummaryChange,
  type SummaryInput,
} from '../ai/index.js';
import { logger } from '../utils/logger.js';
import type { EventHub } from '../server/hub.js';
import { toPublicEvent } from '../server/hub.js';
import { detectLayer } from './layers.js';
import type { RawFileChange } from './batcher.js';

export interface ChangeRecorderOptions {
  db: CodeAnchorDatabase;
  project: Project;
  config: CodeAnchorConfig;
  git: GitRepository | null;
  summarizer: Summarizer;
  hub: EventHub;
  /** Injetável nos testes. */
  queue?: SummaryQueue | undefined;
}

export interface RecordedBatch {
  batchId: string;
  events: ChangeEvent[];
  layers: ChangeEventLayer[];
  summary: string;
}

interface PreparedChange extends SummaryChange {
  diffTruncated: boolean;
}

/**
 * Pipeline do vigia: diff → banco → SSE → log → fila de resumos.
 * O evento é gravado imediatamente com `summary: null`; a IA preenche depois.
 */
export class ChangeRecorder {
  readonly queue: SummaryQueue;
  private readonly db: CodeAnchorDatabase;
  private readonly project: Project;
  private readonly config: CodeAnchorConfig;
  private readonly git: GitRepository | null;
  private readonly summarizer: Summarizer;
  private readonly hub: EventHub;

  constructor(options: ChangeRecorderOptions) {
    this.db = options.db;
    this.project = options.project;
    this.config = options.config;
    this.git = options.git;
    this.summarizer = options.summarizer;
    this.hub = options.hub;
    this.queue =
      options.queue ??
      new SummaryQueue({
        onError: (error: unknown) => {
          logger.error(
            `Falha ao processar resumo: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      });
  }

  async handleBatch(changes: RawFileChange[]): Promise<RecordedBatch | null> {
    if (changes.length === 0) return null;

    const batchId = randomUUID();
    const maxDiffBytes = Math.max(1, this.config.git.maxDiffKb) * 1024;
    const prepared = await Promise.all(
      changes.map(async (change): Promise<PreparedChange> => {
        const diff: GitDiff = this.git
          ? await this.git.diffForFile(change, maxDiffBytes)
          : { diff: '', truncated: false };

        return {
          filePath: change.path,
          changeType: change.changeType,
          layer: detectLayer(change.path),
          diff: diff.diff,
          diffTruncated: diff.truncated,
        };
      }),
    );

    const events = insertChangeEvents(
      this.db,
      prepared.map((change) => ({
        projectId: this.project.id,
        filePath: change.filePath,
        changeType: change.changeType,
        diff: change.diff,
        summary: null,
        batchId,
        layer: change.layer,
        diffTruncated: change.diffTruncated,
      })),
    );

    await this.recordSnapshot();

    for (const event of events) {
      this.hub.publish({ type: 'change', event: toPublicEvent(event) });
    }

    const layers = uniqueLayers(prepared);
    const summary = summarizeHeuristic({
      projectName: this.project.name,
      changes: prepared,
    });

    logger.event(`🛰️ ${batchHeadline(changes, layers)} — resumo: ${truncateForLog(summary)}`);

    for (const [index, event] of events.entries()) {
      const change = prepared[index];
      if (!event || !change) continue;
      this.enqueueSummary(event, change);
    }

    return { batchId, events, layers, summary };
  }

  private enqueueSummary(event: ChangeEvent, change: PreparedChange): void {
    this.queue.enqueue(async () => {
      const input: SummaryInput = {
        projectName: this.project.name,
        changes: [change],
      };

      let summary: string;
      try {
        summary = await this.summarizer.summarize(input);
      } catch {
        summary = summarizeHeuristic(input);
      }

      const trimmed = summary.trim();
      if (trimmed.length === 0) {
        summary = summarizeHeuristic(input);
      } else {
        summary = trimmed;
      }

      const updated = updateChangeEventSummary(this.db, event.id, summary);
      if (updated) {
        this.hub.publish({ type: 'summary', event: toPublicEvent(updated) });
        if (this.summarizer.provider !== 'none') {
          logger.event(`🤖 ${updated.filePath}: ${truncateForLog(updated.summary ?? summary)}`);
        }
      }
    });
  }

  private async recordSnapshot(): Promise<void> {
    try {
      const snapshot = await syncSnapshot(this.db, this.project.id, this.git);
      if (snapshot) {
        logger.detail(`Novo snapshot Git: ${snapshot.commitHash.slice(0, 7)}`);
      }
    } catch (error) {
      logger.warn(
        `Não foi possível registrar o snapshot do Git: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export function batchHeadline(changes: RawFileChange[], layers: ChangeEventLayer[]): string {
  const count = changes.length;
  const fileWord = count === 1 ? 'arquivo' : 'arquivos';
  const allRemoved = changes.every((change) => change.changeType === 'unlink');
  const verb = allRemoved ? 'removido' : 'alterado';
  const verbPlural = allRemoved ? 'removidos' : 'alterados';
  const layerLabel = layers.length > 0 ? ` (${layers.join(', ')})` : '';
  return `${count} ${fileWord} ${count === 1 ? verb : verbPlural}${layerLabel}`;
}

function truncateForLog(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
