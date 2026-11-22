import type { BindingLayer } from '../db/schema.js';
import type {
  BindingMatrix,
  EntityInfo,
  Finding,
  MatrixCell,
  MatrixCellState,
  MatrixLink,
  MatrixRow,
  ProjectMap,
} from './types.js';
import { formatRef } from './types.js';

/** Projeções de leitura não são contratos de persistência. */
const NON_PERSISTED_NAME =
  /(Response|View|Projection|Summary|Resumo|Report|Dashboard|Stats|Statistics|Lookup|Option|Page|Result|Dto)$/i;
/** Nomes que claramente indicam tabela: se não há banco, é falta de amarração. */
const PERSISTENCE_NAME = /(Entity|Model|Table|Record|Document)$/i;

/**
 * A terceira camada não se aplica quando o contrato front ↔ back é de um
 * endpoint de caso de uso (sem tabela própria), não de uma entidade persistida.
 */
function layerNotApplicable(map: ProjectMap, entityName: string, back: EntityInfo): boolean {
  if (map.database.has(entityName) || map.migrationColumns.has(entityName)) return false;
  if (PERSISTENCE_NAME.test(back.rawName)) return false;
  if (!map.endpoints.some((endpoint) => endpoint.entity === entityName)) return false;
  const usedByFront = map.calls.some((call) => call.entity === entityName);
  return usedByFront || NON_PERSISTED_NAME.test(back.rawName) || back.sources.includes('dto');
}

/**
 * Matriz Entidade × Front × Back × Banco.
 * ✅ integrado · ✓ ok (2 de 3, terceira não se aplica) · 🟡 parcial · ⬜ só local · ❌ faltando · ↗ falta amarrar
 */
export function buildMatrix(
  map: ProjectMap,
  findings: Finding[],
  scanId: string | null = null,
): BindingMatrix {
  const entityNames = new Set<string>([
    ...map.frontend.keys(),
    ...map.backend.keys(),
    ...map.database.keys(),
    ...map.migrationColumns.keys(),
  ]);

  const rows: MatrixRow[] = [];
  for (const entityName of [...entityNames].sort()) {
    const front = map.frontend.get(entityName);
    const back = map.backend.get(entityName);
    const db = map.database.get(entityName);

    const pending = findings.filter(
      (finding) =>
        finding.ruleId !== 'GREEN' && finding.entity === entityName && finding.status !== 'green',
    ).length;

    const frontLocal = front ? isLocalOnly(map, entityName) : false;
    const present: BindingLayer[] = [];
    if (front) present.push('frontend');
    if (back) present.push('backend');
    if (db) present.push('database');
    const missing: BindingLayer[] = ['frontend', 'backend', 'database'].filter(
      (layer) => !present.includes(layer as BindingLayer),
    ) as BindingLayer[];

    let status: MatrixRow['status'];
    let link: MatrixLink;
    if (frontLocal) {
      status = 'yellow';
      link = 'local';
    } else if (present.length === 3) {
      if (pending === 0) {
        status = 'green';
        link = 'integrated';
      } else {
        status = 'yellow';
        link = 'partial';
      }
    } else if (front && back && !db && pending === 0 && layerNotApplicable(map, entityName, back)) {
      status = 'ok';
      link = 'ok';
    } else if (front && (back || db) && missing.length > 0) {
      status = 'red';
      link = 'link';
    } else {
      status = 'red';
      link = 'missing';
    }

    rows.push({
      entity: entityName,
      rawName: front?.rawName ?? back?.rawName ?? db?.rawName ?? entityName.replaceAll('_', ' '),
      front: cell(
        front ? (frontLocal ? 'local' : 'integrated') : 'missing',
        front?.fields.length ?? 0,
        front?.refs[0],
      ),
      back: cell(back ? 'integrated' : 'missing', back?.fields.length ?? 0, back?.refs[0]),
      db: cell(db ? 'integrated' : 'missing', db?.fields.length ?? 0, db?.refs[0]),
      status,
      link,
      pending,
      missing,
    });
  }

  const totals = {
    entities: rows.length,
    integrated: rows.filter((row) => row.link === 'integrated').length,
    partial: rows.filter((row) => row.link === 'partial').length,
    ok: rows.filter((row) => row.link === 'ok').length,
    local: rows.filter((row) => row.link === 'local').length,
    missing: rows.filter((row) => row.link === 'missing' || row.link === 'link').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    scanId,
    entities: rows,
    totals,
  };
}

function cell(
  state: MatrixCellState,
  fields: number,
  ref: { file: string; line: number } | undefined,
): MatrixCell {
  return { state, fields, ref: formatRef(ref) };
}

function isLocalOnly(map: ProjectMap, entityName: string): boolean {
  const front = map.frontend.get(entityName);
  if (!front) return false;

  const hasMock = front.refs.some((ref) => map.mockFiles.has(ref.file));
  const hasLocal = front.refs.some((ref) => map.localStorageFiles.has(ref.file));
  const hasCalls = map.calls.some((call) => call.entity === entityName);
  return (hasMock || hasLocal) && !hasCalls;
}
