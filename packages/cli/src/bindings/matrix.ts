import type { BindingLayer, BindingStatus } from '../db/schema.js';
import type {
  BindingMatrix,
  Finding,
  MatrixCell,
  MatrixCellState,
  MatrixLink,
  MatrixRow,
  ProjectMap,
} from './types.js';
import { formatRef } from './types.js';

/**
 * Matriz Entidade × Front × Back × Banco.
 * ✅ integrado · 🟡 parcial · ⬜ só local · ❌ faltando · ↗ falta amarrar
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

    let status: BindingStatus;
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
