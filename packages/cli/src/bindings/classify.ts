import type { BindingLayer } from '../db/schema.js';

/**
 * Classificação de arquivos por camada para o detector.
 *
 * É deliberadamente tolerante: um arquivo pode contribuir para mais de uma
 * camada (ex.: `src/types/user.ts` é front-end, `server/routes/user.ts` é
 * back-end e `db/schema.ts` é banco). A heurística combina extensão, caminho e
 * marcadores de conteúdo para funcionar em React/Next/Fastify, Spring e FastAPI.
 */

const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.vue',
  '.svelte',
  '.astro',
  '.java',
  '.kt',
  '.py',
  '.sql',
  '.prisma',
  '.rb',
  '.php',
  '.cs',
  '.go',
]);

const FRONTEND_SEGMENTS = new Set([
  'components',
  'component',
  'pages',
  'page',
  'views',
  'view',
  'layouts',
  'hooks',
  'store',
  'stores',
  'contexts',
  'context',
  'frontend',
  'client',
  'web',
  'ui',
  'app',
  'styles',
]);

const BACKEND_SEGMENTS = new Set([
  'server',
  'backend',
  'api',
  'apis',
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
  'endpoints',
  'endpoint',
  'resources',
  'jobs',
  'workers',
]);

const DATABASE_SEGMENTS = new Set([
  'db',
  'database',
  'databases',
  'schema',
  'schemas',
  'models',
  'model',
  'entities',
  'entity',
  'migrations',
  'migration',
  'prisma',
  'seeds',
  'seeders',
  'flyway',
  'liquibase',
]);

const DATABASE_MARKERS =
  /(sqliteTable|pgTable|mysqlTable|mariadbTable|defineTable|drizzle-orm|@Entity\b|@Table\b|@Column\b|declarative_base|__tablename__|Column\(|sequelize\.define|PrismaClient|model\s+\w+\s*\{)/;

const BACKEND_MARKERS =
  /(@RestController|@Controller\b|@GetMapping|@PostMapping|@PutMapping|@PatchMapping|@DeleteMapping|@RequestMapping|fastify\.(get|post|put|patch|delete)|(?:app|router|server|api)\.(get|post|put|patch|delete)\s*\(|from ['"]fastify['"]|from ['"]express['"]|require\(['"]express['"]\)|NextResponse|NextRequest|export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b|@nestjs\/common|APIRouter|FastAPI|BaseModel|pydantic|@app\.(get|post|put|patch|delete)|@router\.(get|post|put|patch|delete))/;

const FRONTEND_MARKERS =
  /(from ['"]react['"]|from ['"]react-router|useState\s*\(|useEffect\s*\(|useForm\s*[<(]|fetch\s*\(|axios\.|localStorage|<Route\b|createBrowserRouter|defineComponent|v-model|@Component\s*\(\s*\{)/;

export function extensionOf(file: string): string {
  const base = file.replaceAll('\\', '/').split('/').pop() ?? '';
  const index = base.lastIndexOf('.');
  return index <= 0 ? '' : base.slice(index).toLowerCase();
}

export function isSupportedBindingFile(file: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extensionOf(file));
}

export function classifyFile(file: string, content: string): BindingLayer[] {
  const extension = extensionOf(file);
  const normalized = file.replaceAll('\\', '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);

  const database = isDatabaseFile(extension, segments, content);
  const backend = isBackendFile(extension, segments, content);
  const frontend = isFrontendFile(extension, segments, content);

  if (database || backend || frontend) {
    const layers: BindingLayer[] = [];
    if (frontend) layers.push('frontend');
    if (backend) layers.push('backend');
    if (database) layers.push('database');
    return layers;
  }

  // Arquivos TS/JS de domínio sem marcadores claros: tratamos como front-end,
  // que é o caso mais comum de tipos/interfaces consumidos pela UI.
  if (['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.astro'].includes(extension)) {
    return ['frontend'];
  }
  return [];
}

function isDatabaseFile(extension: string, segments: string[], content: string): boolean {
  if (extension === '.sql' || extension === '.prisma') return true;
  if (segments.some((segment) => DATABASE_SEGMENTS.has(segment))) return true;
  return DATABASE_MARKERS.test(content);
}

function isBackendFile(extension: string, segments: string[], content: string): boolean {
  if (['.java', '.kt', '.py', '.rb', '.php', '.cs', '.go'].includes(extension)) {
    // Java com @Entity é banco; controllers/DTOs são back-end.
    if (/@Entity\b/.test(content) && !/@RestController|@Controller\b/.test(content)) return false;
    return true;
  }

  if (segments.some((segment) => BACKEND_SEGMENTS.has(segment))) {
    // Uma página dentro de `app/` do Next é front-end, mas `app/api/**` é back-end.
    if (segments.includes('api')) return true;
    if (
      segments.some((segment) => FRONTEND_SEGMENTS.has(segment)) &&
      !BACKEND_MARKERS.test(content)
    ) {
      if (segments.some((segment) => DATABASE_SEGMENTS.has(segment))) return false;
      if (extension === '.tsx' || extension === '.jsx') return false;
    }
    return true;
  }

  return BACKEND_MARKERS.test(content);
}

function isFrontendFile(extension: string, segments: string[], content: string): boolean {
  // app/api/** e pages/api/** são back-end mesmo estando sob `app/`.
  if (segments.includes('api') && BACKEND_MARKERS.test(content)) return false;
  if (['.tsx', '.jsx', '.vue', '.svelte', '.astro'].includes(extension)) return true;
  if (segments.some((segment) => FRONTEND_SEGMENTS.has(segment))) return true;
  if (extension === '.ts' || extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    if (BACKEND_MARKERS.test(content) || DATABASE_MARKERS.test(content)) return false;
    return FRONTEND_MARKERS.test(content);
  }
  return false;
}
