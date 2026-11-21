import {
  getLatestSnapshot,
  insertSnapshot,
  type CodeAnchorDatabase,
  type Snapshot,
} from '../db/index.js';
import type { GitRepository } from './diff.js';

/**
 * Compara o HEAD atual com o último snapshot gravado e registra um novo quando
 * um commit foi detectado. Retorna o snapshot criado (ou null se nada mudou).
 */
export async function syncSnapshot(
  db: CodeAnchorDatabase,
  projectId: string,
  git: GitRepository | null,
): Promise<Snapshot | null> {
  if (!git) return null;

  const head = await git.headHash();
  if (!head) return null;

  const latest = getLatestSnapshot(db, projectId);
  if (latest?.commitHash === head) return null;

  return insertSnapshot(db, { projectId, commitHash: head });
}

export interface HeadWatcherOptions {
  db: CodeAnchorDatabase;
  projectId: string;
  git: GitRepository | null;
  intervalMs?: number;
  onSnapshot?: (snapshot: Snapshot) => void;
  onError?: (error: unknown) => void;
}

export interface HeadWatcher {
  close(): void;
}

/**
 * Polling leve do HEAD para detectar commits mesmo quando nenhum arquivo é
 * editado (o `.git` em si é ignorado pelo vigia).
 */
export function startHeadWatcher(options: HeadWatcherOptions): HeadWatcher {
  if (!options.git) return { close: () => undefined };

  const intervalMs = options.intervalMs ?? 5000;
  let inFlight = false;

  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void syncSnapshot(options.db, options.projectId, options.git)
      .then((snapshot) => {
        if (snapshot) options.onSnapshot?.(snapshot);
      })
      .catch((error: unknown) => {
        options.onError?.(error);
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);

  timer.unref?.();

  return {
    close(): void {
      clearInterval(timer);
    },
  };
}
