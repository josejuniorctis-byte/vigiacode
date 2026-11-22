import { existsSync, readFileSync } from 'node:fs';
import { projectEnvPath } from '../config.js';

export interface EnvLoadResult {
  /** Caminho do arquivo lido (null se não existir). */
  file: string | null;
  /** Variáveis efetivamente definidas (nomes apenas, nunca valores). */
  loaded: string[];
}

/**
 * Carrega `.vigiacode/.env` sem sobrescrever variáveis já definidas no ambiente.
 * Formato aceito: KEY=valor, export KEY=valor, comentários com # e valores entre
 * aspas simples/duplas.
 */
export function loadProjectEnv(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvLoadResult {
  const file = projectEnvPath(projectRoot);
  if (!existsSync(file)) return { file: null, loaded: [] };

  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return { file: null, loaded: [] };
  }

  const loaded: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (env[parsed.key] !== undefined) continue;
    env[parsed.key] = parsed.value;
    loaded.push(parsed.key);
  }

  return { file, loaded };
}

export interface ParsedEnvLine {
  key: string;
  value: string;
}

export function parseEnvLine(line: string): ParsedEnvLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null;

  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trim()
    : trimmed;
  const separator = withoutExport.indexOf('=');
  if (separator <= 0) return null;

  const key = withoutExport.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = withoutExport.slice(separator + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}
