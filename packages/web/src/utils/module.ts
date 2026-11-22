const ROOT_SEGMENTS = new Set(['com', 'org', 'io', 'net', 'br', 'app', 'src', 'main', 'test']);
const SKIPPED_SEGMENTS = new Set(['src', 'app', 'lib', 'packages', 'server', 'client']);

/** Mesmo critério do Arquiteto: primeiro segmento "humano" do caminho. */
export function moduleOfPath(ref: string | null): string | null {
  if (!ref) return null;
  const filePath = ref.replace(/:\d+$/, '');
  const segments = filePath.replaceAll('\\', '/').split('/').filter(Boolean);
  const javaIndex = segments.findIndex((segment) => segment === 'java' || segment === 'kotlin');

  if (javaIndex >= 0) {
    const parts = segments.slice(javaIndex + 1, -1);
    const erpIndex = parts.indexOf('erp');
    if (erpIndex >= 0 && parts[erpIndex + 1]) return parts[erpIndex + 1] ?? null;
    const meaningful = parts.find((segment) => !ROOT_SEGMENTS.has(segment));
    return meaningful ?? parts[0] ?? 'raiz';
  }

  let index = 0;
  while (index < segments.length - 1 && SKIPPED_SEGMENTS.has(segments[index] ?? '')) {
    index += 1;
  }
  const first = segments[index];
  if (first === 'features' || first === 'modules') {
    return segments[index + 1] ?? first;
  }
  return first ?? null;
}

export function moduleOfBinding(refs: Array<string | null>): string {
  for (const ref of refs) {
    const module = moduleOfPath(ref);
    if (module) return module;
  }
  return 'raiz';
}
