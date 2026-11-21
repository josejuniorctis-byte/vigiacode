import type { ChangeEventLayer } from '../db/schema.js';

/**
 * Detecção simples de camada por caminho e extensão.
 * A ordem importa: banco e configuração têm prioridade sobre front/back.
 */
export function detectLayer(filePath: string): ChangeEventLayer {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments[segments.length - 1] ?? '';
  const extension = extensionOf(basename);

  if (isDatabase(normalized, basename, extension, segments)) return 'database';
  if (isConfig(basename, segments)) return 'config';
  if (isFrontend(extension, segments)) return 'frontend';
  if (isBackend(extension, segments)) return 'backend';
  return 'other';
}

function isDatabase(
  normalized: string,
  basename: string,
  extension: string,
  segments: string[],
): boolean {
  if (extension === '.sql' || extension === '.prisma') return true;
  if (basename === 'schema.prisma' || basename === 'drizzle.config.ts') return true;
  if (basename === 'drizzle.config.js' || basename === 'drizzle.config.mjs') return true;
  if (normalized.includes('/migrations/') || normalized.startsWith('migrations/')) return true;
  const databaseSegments = new Set([
    'migrations',
    'migration',
    'prisma',
    'database',
    'databases',
    'db',
    'schema',
    'schemas',
    'seeds',
    'seeders',
  ]);
  return segments.some((segment) => databaseSegments.has(segment));
}

function isConfig(basename: string, segments: string[]): boolean {
  if (
    basename === 'package.json' ||
    basename === 'tsconfig.json' ||
    basename === 'dockerfile' ||
    basename === '.editorconfig' ||
    basename === '.gitignore' ||
    basename === '.npmrc' ||
    basename === 'pnpm-workspace.yaml' ||
    basename === 'pnpm-workspace.yml'
  ) {
    return true;
  }

  if (/^(tsconfig|jsconfig)\..*\.json$/.test(basename)) return true;
  if (/\.config\.(js|mjs|cjs|ts|mts|cts)$/.test(basename)) return true;
  if (basename.startsWith('.env')) return true;
  if (basename.startsWith('docker-compose')) return true;
  if (/^(eslint|prettier|vite|vitest|tailwind|postcss|next|nuxt|rollup|webpack)\./.test(basename)) {
    return true;
  }
  if (segments.some((segment) => segment === 'config' || segment === 'configs')) return true;
  if (segments[0] === '.github' || segments[0] === '.vscode') return true;

  return false;
}

function isFrontend(extension: string, segments: string[]): boolean {
  const frontendExtensions = new Set([
    '.tsx',
    '.jsx',
    '.vue',
    '.svelte',
    '.astro',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.html',
  ]);
  if (frontendExtensions.has(extension)) return true;

  const frontendSegments = new Set([
    'components',
    'component',
    'pages',
    'views',
    'layouts',
    'styles',
    'public',
    'frontend',
    'client',
    'ui',
  ]);
  return segments.some((segment) => frontendSegments.has(segment));
}

function isBackend(extension: string, segments: string[]): boolean {
  const backendSegments = new Set([
    'routes',
    'route',
    'controllers',
    'controller',
    'services',
    'service',
    'handlers',
    'handler',
    'middlewares',
    'middleware',
    'resolvers',
    'resolver',
    'api',
    'server',
    'backend',
    'jobs',
    'workers',
  ]);
  if (segments.some((segment) => backendSegments.has(segment))) return true;

  const backendExtensions = new Set(['.go', '.java', '.rb', '.php', '.cs', '.rs', '.kt']);
  return backendExtensions.has(extension);
}

function extensionOf(basename: string): string {
  const index = basename.lastIndexOf('.');
  return index <= 0 ? '' : basename.slice(index);
}
