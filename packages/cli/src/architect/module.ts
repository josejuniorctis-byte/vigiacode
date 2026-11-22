import path from 'node:path';

const ROOT_SEGMENTS = new Set(['com', 'org', 'io', 'net', 'br', 'app', 'src', 'main', 'test']);
const SKIPPED_SEGMENTS = new Set(['src', 'app', 'lib', 'packages', 'server', 'client']);

/**
 * Módulo "humano" de um arquivo: primeiro segmento significativo da pasta ou
 * pacote Java (ex.: `.../erp/replenishment/api/dto/X.java` → `replenishment`).
 */
export function moduleOfPath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const javaIndex = segments.findIndex((segment) => segment === 'java' || segment === 'kotlin');

  if (javaIndex >= 0) {
    const parts = segments.slice(javaIndex + 1, -1);
    const erpIndex = parts.indexOf('erp');
    if (erpIndex >= 0 && parts[erpIndex + 1]) return parts[erpIndex + 1] as string;
    const meaningful = parts.find((segment) => !ROOT_SEGMENTS.has(segment));
    return meaningful ?? parts[0] ?? 'raiz';
  }

  let index = 0;
  while (index < segments.length - 1 && SKIPPED_SEGMENTS.has(segments[index] as string)) {
    index += 1;
  }
  const first = segments[index];
  if (first === 'features' || first === 'modules') {
    return segments[index + 1] ?? first;
  }
  return first ?? 'raiz';
}

export function dirOf(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  return path.posix.dirname(normalized);
}

export function extensionOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function baseNameOf(filePath: string): string {
  return path.posix.basename(filePath.replaceAll('\\', '/'));
}
