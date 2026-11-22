import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { VigiaCodeConfig } from '../config.js';
import { IgnoreMatcher, createIgnoreMatcher } from '../watcher/ignore.js';

export interface TodoComment {
  file: string;
  line: number;
  marker: 'TODO' | 'FIXME' | 'HACK';
  text: string;
}

const TODO_PATTERN = /\b(TODO|FIXME|HACK)\b[:\s-]*(.*)$/i;

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.java',
  '.kt',
  '.kts',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.php',
  '.cs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.sql',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.yml',
  '.yaml',
  '.json',
  '.xml',
  '.properties',
  '.gradle',
]);

const MAX_FILE_BYTES = 500 * 1024;

export function isTodoCandidateFile(file: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/** Extrai comentários TODO/FIXME/HACK de um arquivo. */
export function extractTodoComments(file: string, content: string): TodoComment[] {
  const comments: TodoComment[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes('TODO') && !line.includes('FIXME') && !line.includes('HACK')) {
      // Evita regex em todas as linhas de arquivos grandes sem marcadores.
      if (!/todo|fixme|hack/i.test(line)) continue;
    }
    const match = TODO_PATTERN.exec(line);
    if (!match) continue;
    const marker = (match[1] ?? 'TODO').toUpperCase() as TodoComment['marker'];
    comments.push({
      file,
      line: index + 1,
      marker,
      text: (match[2] ?? '').trim().slice(0, 200),
    });
  }
  return comments;
}

export interface CollectTodosOptions {
  projectRoot: string;
  config: VigiaCodeConfig;
  /** Quando presente, analisa só estes arquivos (scan incremental do vigia). */
  files?: readonly string[] | undefined;
}

/** Percorre o projeto (ou uma lista de arquivos) coletando TODOs. */
export function collectTodoComments(options: CollectTodosOptions): TodoComment[] {
  const { projectRoot, config } = options;
  const bindingsIgnore = new IgnoreMatcher(config.bindings.ignore);
  const watchMatcher = createIgnoreMatcher(projectRoot, config.watch);
  const files = options.files ?? walkTextFiles(projectRoot, config);
  const comments: TodoComment[] = [];

  for (const file of files) {
    if (!isTodoCandidateFile(file)) continue;
    if (bindingsIgnore.ignores(file) || watchMatcher.ignores(file)) continue;
    const absolute = path.resolve(projectRoot, file);
    try {
      if (!existsSync(absolute)) continue;
      const stats = statSync(absolute);
      if (!stats.isFile() || stats.size > MAX_FILE_BYTES) continue;
      comments.push(...extractTodoComments(file, readFileSync(absolute, 'utf8')));
    } catch {
      // Arquivo ilegível/binário: ignora.
    }
  }
  return comments;
}

function walkTextFiles(projectRoot: string, config: VigiaCodeConfig): string[] {
  const bindingsIgnore = new IgnoreMatcher(config.bindings.ignore);
  const watchMatcher = createIgnoreMatcher(projectRoot, config.watch);
  const files: string[] = [];

  const visit = (directory: string, relativeDirectory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative =
        relativeDirectory.length > 0 ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          watchMatcher.ignores(relative, true) ||
          bindingsIgnore.ignores(relative, true)
        ) {
          continue;
        }
        visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (watchMatcher.ignores(relative) || bindingsIgnore.ignores(relative)) continue;
      if (!isTodoCandidateFile(relative)) continue;
      files.push(relative);
    }
  };

  visit(projectRoot, '');
  return files;
}
