import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { ChangeType } from '../db/schema.js';

/**
 * Captura de diffs via simple-git.
 *
 * - `change`: diff do working tree em relação ao HEAD (inclui staged + unstaged)
 * - `unlink`: diff de remoção em relação ao HEAD
 * - `add`: se o arquivo já estiver rastreado, diff normal; se for novo/untracked,
 *   gera um diff completo sintético a partir do conteúdo do arquivo
 *
 * Se o projeto não for um repositório Git, `openGitRepository` devolve null e o
 * vigia continua funcionando em modo "sem diff".
 */

export interface GitFileChange {
  path: string;
  changeType: ChangeType;
}

export interface GitDiff {
  diff: string;
  truncated: boolean;
}

export interface GitRepositoryOptions {
  maxConcurrentProcesses?: number;
}

export class GitRepository {
  private constructor(
    private readonly git: SimpleGit,
    readonly root: string,
  ) {}

  static async open(
    root: string,
    options: GitRepositoryOptions = {},
  ): Promise<GitRepository | null> {
    try {
      const git = simpleGit({
        baseDir: root,
        binary: 'git',
        maxConcurrentProcesses: options.maxConcurrentProcesses ?? 1,
        trimmed: false,
      });
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return null;
      return new GitRepository(git, root);
    } catch {
      return null;
    }
  }

  /** Hash do HEAD ou null se o repositório ainda não tem commits. */
  async headHash(): Promise<string | null> {
    try {
      const hash = (await this.git.revparse(['HEAD'])).trim();
      return hash.length > 0 ? hash : null;
    } catch {
      return null;
    }
  }

  /** Branch atual (ou null em detached HEAD / sem commits). */
  async branchName(): Promise<string | null> {
    try {
      const branch = (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      return branch.length > 0 && branch !== 'HEAD' ? branch : null;
    } catch {
      return null;
    }
  }

  /**
   * Diff de um arquivo, truncado em `maxBytes` (por padrão 200 KB).
   * Nunca lança: em caso de erro de git devolve diff vazio.
   */
  async diffForFile(change: GitFileChange, maxBytes: number): Promise<GitDiff> {
    try {
      let diff = '';

      if (change.changeType === 'unlink') {
        diff = await this.diffAgainstHead(change.path);
      } else {
        diff = await this.diffAgainstHead(change.path);
        // Arquivo novo (ou ainda não rastreado): mostra o conteúdo completo.
        if (!diff) {
          diff = await this.untrackedFileDiff(change.path);
        }
      }

      return truncateDiff(diff, maxBytes);
    } catch {
      return { diff: '', truncated: false };
    }
  }

  private async diffAgainstHead(filePath: string): Promise<string> {
    const hasHead = (await this.headHash()) !== null;
    if (!hasHead) {
      // Sem commits ainda: para arquivo existente, mostra o conteúdo completo.
      return this.untrackedFileDiff(filePath);
    }
    try {
      return await this.git.diff(['HEAD', '--', filePath]);
    } catch {
      return '';
    }
  }

  /** Diff completo (arquivo novo) no formato unificado do git. */
  private async untrackedFileDiff(filePath: string): Promise<string> {
    const absolute = path.resolve(this.root, filePath);
    const content = await readTextFile(absolute);
    if (content === null) return '';

    const lines = content.split(/\r?\n/);
    // Remove o último item vazio quando o arquivo termina com quebra de linha.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const normalized = filePath.split(path.sep).join('/');
    const header = [
      `diff --git a/${normalized} b/${normalized}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${normalized}`,
      `@@ -0,0 +1,${lines.length} @@`,
    ];

    const body = lines.map((line) => `+${line}`);
    return `${[...header, ...body].join('\n')}\n`;
  }
}

/** Trunca por bytes sem quebrar caracteres UTF-8. */
export function truncateDiff(diff: string, maxBytes: number): GitDiff {
  if (maxBytes <= 0 || diff.length === 0) return { diff, truncated: false };

  const size = Buffer.byteLength(diff, 'utf8');
  if (size <= maxBytes) return { diff, truncated: false };

  const marker = `\n\n[diff truncado pelo CodeAnchor: ${size - maxBytes} bytes omitidos]\n`;
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  const sliced = Buffer.from(diff, 'utf8').subarray(0, budget).toString('utf8');

  // Remove possível caractere multi-byte cortado no final.
  const sanitized = sliced.replace(/\uFFFD+$/u, '');
  return { diff: `${sanitized}${marker}`, truncated: true };
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    const buffer = await readFile(filePath);
    if (isProbablyBinary(buffer)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

/** Heurística simples: NUL no início do arquivo indica binário. */
export function isProbablyBinary(buffer: Uint8Array): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}
