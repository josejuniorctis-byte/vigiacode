import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WatchConfig } from '../config.js';

/**
 * Matcher de ignores no estilo .gitignore, sem dependências externas.
 *
 * Regras:
 * - nomes/padrões sem barra casam com qualquer segmento do caminho;
 * - padrões com barra casam a partir de qualquer nível (a menos que comecem com `/`);
 * - `*`, `**`, `?` e classes `[...]` são suportados;
 * - `!padrão` re-inclui (última regra vence), exceto diretórios sempre ignorados;
 * - node_modules, dist, .git, .vigiacode etc. são SEMPRE ignorados.
 */

const ALWAYS_IGNORED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vigiacode',
  '.idea',
  '.vscode',
]);

const ALWAYS_IGNORED_PATTERNS = [
  '*.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  '*.min.js',
  '*.min.css',
  '.DS_Store',
  'Thumbs.db',
];

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.tgz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.mov',
  '.avi',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.bin',
  '.class',
  '.jar',
]);

export interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
}

export class IgnoreMatcher {
  private readonly rules: IgnoreRule[];

  constructor(patterns: string[]) {
    this.rules = patterns
      .map((pattern) => compileIgnorePattern(pattern))
      .filter((rule): rule is IgnoreRule => rule !== null);
  }

  ignores(relativePath: string, isDirectory = false): boolean {
    const normalized = normalizeRelativePath(relativePath);
    if (normalized.length === 0) return false;

    const segments = normalized.split('/');
    if (segments.some((segment) => ALWAYS_IGNORED_SEGMENTS.has(segment))) {
      return true;
    }

    let ignored = false;
    for (const rule of this.rules) {
      if (rule.regex.test(normalized) || (isDirectory && rule.regex.test(`${normalized}/`))) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

/** Monta o matcher com padrões do config, padrões fixos e o .gitignore do usuário. */
export function createIgnoreMatcher(projectRoot: string, config: WatchConfig): IgnoreMatcher {
  const patterns = [...ALWAYS_IGNORED_PATTERNS, ...config.ignore, ...readGitignore(projectRoot)];
  return new IgnoreMatcher(patterns);
}

export function readGitignore(projectRoot: string): string[] {
  try {
    const content = readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

export function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function normalizeRelativePath(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function compileIgnorePattern(pattern: string): IgnoreRule | null {
  let raw = pattern.trim();
  if (raw.length === 0 || raw.startsWith('#')) return null;

  let negated = false;
  if (raw.startsWith('!')) {
    negated = true;
    raw = raw.slice(1).trim();
    if (raw.length === 0) return null;
  }

  raw = raw.replaceAll('\\', '/').replace(/^\.\/+/, '');
  raw = raw.replace(/\/+$/, '');
  if (raw.length === 0) return null;

  const anchored = raw.startsWith('/');
  if (anchored) raw = raw.slice(1);
  if (raw.length === 0) return null;

  const hasSlash = raw.includes('/');
  const body = globToRegex(raw);
  let source: string;

  if (anchored) {
    source = `^${body}(?:/.*)?$`;
  } else if (hasSlash) {
    source = `(?:^|/)${body}(?:/.*)?$`;
  } else {
    source = `(?:^|/)${body}(?:/.*)?$`;
  }

  const flags = process.platform === 'win32' ? 'i' : '';
  return { regex: new RegExp(source, flags), negated };
}

export function globToRegex(glob: string): string {
  let result = '';

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === undefined) break;

    if (char === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') {
          index += 1;
          result += '(?:.*/)?';
        } else {
          result += '.*';
        }
      } else {
        result += '[^/]*';
      }
    } else if (char === '?') {
      result += '[^/]';
    } else if (char === '[') {
      const end = glob.indexOf(']', index + 1);
      if (end === -1) {
        result += '\\[';
      } else {
        const content = glob.slice(index + 1, end).replace(/^!/, '^');
        result += `[${content}]`;
        index = end;
      }
    } else {
      result += escapeRegExp(char);
    }
  }

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
