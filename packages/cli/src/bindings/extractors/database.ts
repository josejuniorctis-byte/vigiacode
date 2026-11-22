import ts from 'typescript';
import { normalizeEntityName, normalizeFieldName } from '../names.js';
import { classifyFile, extensionOf } from '../classify.js';
import {
  emptyFileExtract,
  type EntityInfo,
  type FileExtract,
  type LayerExtractor,
  type MigrationField,
  type MigrationTable,
} from '../types.js';
import { lineOf, parseSource, stringValue } from './ast.js';
import { addEntity, addField, makeField, ref } from './common.js';

const PRISMA_SCALARS = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
  'Uuid',
]);

/**
 * Extrai do banco:
 * - Drizzle (sqliteTable/pgTable/mysqlTable);
 * - Prisma (model + @@map);
 * - TypeORM (@Entity/@Column);
 * - JPA (@Entity/@Table/@Column);
 * - migrations SQL (CREATE TABLE, ALTER TABLE, inclusive Flyway V*__*.sql).
 */
export const databaseExtractor: LayerExtractor = {
  name: 'database',
  layer: 'database',
  supports(file, content) {
    return classifyFile(file, content).includes('database');
  },
  extract({ file, content }): FileExtract {
    const output = emptyFileExtract(file, 'database', 'database');
    const extension = extensionOf(file);

    if (extension === '.prisma') {
      extractPrisma(file, content, output);
      return output;
    }
    if (extension === '.sql') {
      extractSql(file, content, output);
      return output;
    }
    if (['.java', '.kt'].includes(extension)) {
      extractJpa(file, content, output);
      return output;
    }
    if (['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].includes(extension)) {
      extractTypeScript(file, content, output);
      return output;
    }

    return output;
  },
};

function extractTypeScript(file: string, content: string, output: FileExtract): void {
  const sourceFile = parseSource(file, content);
  const drizzle = extractDrizzle(file, sourceFile, output);
  if (drizzle) return;
  extractTypeOrm(file, sourceFile, output);
}

function extractDrizzle(file: string, sourceFile: ts.SourceFile, output: FileExtract): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = node.initializer.expression.getText(sourceFile);
      if (/(?:sqlite|pg|mysql|mariadb)Table$/.test(callee)) {
        const call = node.initializer;
        const tableName =
          stringValue(call.arguments[0]) ?? (ts.isIdentifier(node.name) ? node.name.text : 'table');
        const columns = call.arguments[1];
        if (!columns || !ts.isObjectLiteralExpression(columns)) {
          ts.forEachChild(node, visit);
          return;
        }

        const entity = addEntity(
          output.entities,
          'database',
          tableName,
          ref(file, lineOf(sourceFile, node)),
          'entity',
        );
        if (entity) {
          found = true;
          for (const property of columns.properties) {
            if (!ts.isPropertyAssignment(property) || !property.name) continue;
            const key = property.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
            const initializer = property.initializer;
            if (!ts.isCallExpression(initializer)) continue;
            const base = baseCall(initializer);
            const columnType = base.expression.getText(sourceFile).split('.').pop() ?? '';
            const columnName = stringValue(base.arguments[0]) ?? key;
            const chain = initializer.getText(sourceFile);
            addField(
              entity,
              makeField({
                rawName: columnName,
                rawType: columnType,
                optional: !/\.notNull\(\)/.test(chain),
                ref: ref(file, lineOf(sourceFile, property)),
                source: 'column',
              }),
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function extractTypeOrm(file: string, sourceFile: ts.SourceFile, output: FileExtract): void {
  const hasEntity = /@Entity\b/.test(sourceFile.getText(sourceFile));
  if (!hasEntity) return;

  const visit = (node: ts.Node): void => {
    if (!ts.isClassDeclaration(node) || !node.name) {
      ts.forEachChild(node, visit);
      return;
    }

    const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
    const entityDecorator = decorators.find((decorator) => {
      const name = decoratorName(decorator, sourceFile);
      return name === 'Entity';
    });
    if (!entityDecorator) {
      ts.forEachChild(node, visit);
      return;
    }

    const tableName = decoratorStringArgument(entityDecorator) || node.name.text;
    const entity = addEntity(
      output.entities,
      'database',
      tableName,
      ref(file, lineOf(sourceFile, node)),
      'entity',
    );
    if (!entity) return;

    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member) || !member.name) continue;
      const memberDecorators = ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : [];
      const column = memberDecorators.find((decorator) => {
        const name = decoratorName(decorator, sourceFile);
        return name === 'Column' || name?.endsWith('Column') || name === 'PrimaryColumn';
      });
      if (!column) continue;

      const propertyName = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
      const columnName = decoratorNamedArgument(column, sourceFile, 'name') || propertyName;
      const explicitType = decoratorStringArgument(column);
      const rawType = explicitType || member.type?.getText(sourceFile) || null;

      addField(
        entity,
        makeField({
          rawName: columnName,
          rawType,
          optional: Boolean(member.questionToken),
          ref: ref(file, lineOf(sourceFile, member)),
          source: 'column',
        }),
      );
    }
  };

  visit(sourceFile);
}

/** `integer('id').primaryKey()` → a chamada base `integer('id')`. */
function baseCall(call: ts.CallExpression): ts.CallExpression {
  let expression: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(expression)) {
    expression = expression.expression;
  }
  return ts.isCallExpression(expression) ? expression : call;
}

function decoratorName(decorator: ts.Decorator, sourceFile: ts.SourceFile): string {
  const expression = decorator.expression;
  return ts.isCallExpression(expression)
    ? expression.expression.getText(sourceFile)
    : expression.getText(sourceFile);
}

function decoratorStringArgument(decorator: ts.Decorator): string | null {
  if (!ts.isCallExpression(decorator.expression)) return null;
  const first = decorator.expression.arguments[0];
  if (first && ts.isStringLiteral(first)) return first.text;
  return null;
}

function decoratorNamedArgument(
  decorator: ts.Decorator,
  sourceFile: ts.SourceFile,
  name: string,
): string | null {
  if (!ts.isCallExpression(decorator.expression)) return null;
  const first = decorator.expression.arguments[0];
  if (!first || !ts.isObjectLiteralExpression(first)) return null;
  for (const property of first.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    if (property.name.getText(sourceFile).toLowerCase() !== name.toLowerCase()) continue;
    return stringValue(property.initializer);
  }
  return null;
}

function extractPrisma(file: string, content: string, output: FileExtract): void {
  const lines = content.split(/\r?\n/);
  let current: EntityInfo | null = null;

  for (const [index, line] of lines.entries()) {
    const modelMatch = /^\s*model\s+(\w+)\s*\{/.exec(line);
    if (modelMatch?.[1]) {
      current = addEntity(
        output.entities,
        'database',
        modelMatch[1],
        ref(file, index + 1),
        'entity',
      );
      continue;
    }

    if (current && /^\s*\}/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;

    const mapMatch = /@@map\(\s*["']([^"']+)["']\s*\)/.exec(line);
    if (mapMatch?.[1]) {
      current.rawName = mapMatch[1];
      continue;
    }
    if (/^\s*@@/.test(line) || /^\s*\/\//.test(line)) continue;

    const fieldMatch = /^\s*(\w+)\s+([A-Za-z]\w*)(\[\])?(\?)?/.exec(line);
    if (!fieldMatch?.[1] || !fieldMatch[2]) continue;
    if (!PRISMA_SCALARS.has(fieldMatch[2])) continue;
    if (/@relation/.test(line) || /\[\]/.test(fieldMatch[3] ?? '')) continue;

    addField(
      current,
      makeField({
        rawName: fieldMatch[1],
        rawType: fieldMatch[2],
        optional: Boolean(fieldMatch[4]),
        ref: ref(file, index + 1),
        source: 'column',
      }),
    );
  }
}

/** JPA/Hibernate: @Entity, @Table(name=...) e @Column(name=...). */
function extractJpa(file: string, content: string, output: FileExtract): void {
  const lines = content.split(/\r?\n/);
  let pendingTable: string | null = null;
  let current: EntityInfo | null = null;
  let wasEntity = false;
  let pendingColumn: string | null = null;
  let pendingTransient = false;

  for (const [index, line] of lines.entries()) {
    const entityMatch = /@Entity\b/.test(line);
    if (entityMatch) wasEntity = true;

    const tableMatch = /@Table\s*\([^)]*name\s*=\s*["']([^"']+)["']/.exec(line);
    if (tableMatch?.[1]) pendingTable = tableMatch[1];

    const classMatch = /(?:public\s+)?class\s+(\w+)/.exec(line);
    if (classMatch?.[1] && wasEntity) {
      current = addEntity(
        output.entities,
        'database',
        pendingTable ?? classMatch[1],
        ref(file, index + 1),
        'entity',
      );
      wasEntity = false;
      pendingTable = null;
      continue;
    }

    if (current && /^\s*\}\s*$/.test(line)) {
      current = null;
      continue;
    }

    if (/@Transient\b/.test(line)) pendingTransient = true;

    const columnMatch = /@Column\s*\(([^)]*)\)/.exec(line);
    if (columnMatch?.[1]) {
      const named = /name\s*=\s*["']([^"']+)["']/.exec(columnMatch[1]);
      pendingColumn = named?.[1] ?? null;
    }
    if (/@(Id|EmbeddedId)\b/.test(line)) pendingColumn = pendingColumn ?? 'id';

    if (!current) continue;

    // Constantes (enum-like), serialVersionUID e campos @Transient não são
    // colunas persistidas.
    if (/\bstatic\b/.test(line) || /serialVersionUID/.test(line)) {
      pendingColumn = null;
      pendingTransient = false;
      continue;
    }

    const fieldMatch =
      /^\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:private|protected|public)\s+(?:final\s+)?([\w.<>, ?]+?)\s+(\w+)\s*(?:=[^;]*)?;/.exec(
        line,
      );
    if (!fieldMatch?.[1] || !fieldMatch[2]) continue;

    if (pendingTransient) {
      pendingColumn = null;
      pendingTransient = false;
      continue;
    }

    // Relações 1:N/N:N e coleções não são colunas da tabela.
    if (
      /<[^>]+>/.test(fieldMatch[1]) &&
      /^(List|Set|Collection|Map|SortedSet|SortedMap)</.test(fieldMatch[1].trim())
    ) {
      pendingColumn = null;
      continue;
    }
    if (/@(OneToMany|ManyToMany|ElementCollection)\b/.test(line)) {
      pendingColumn = null;
      continue;
    }

    addField(
      current,
      makeField({
        rawName: pendingColumn ?? fieldMatch[2],
        rawType: fieldMatch[1],
        ref: ref(file, index + 1),
        source: 'column',
      }),
    );
    pendingColumn = null;
  }
}

/** SQL: migrations Drizzle, Flyway, Liquibase etc. */
function extractSql(file: string, content: string, output: FileExtract): void {
  const clean = stripSqlComments(content);
  const tables = new Map<string, MigrationTable>();

  for (const table of parseCreateTables(clean, file)) {
    tables.set(table.entity, table);
  }
  for (const alteration of parseAlterTables(clean, file)) {
    const existing = tables.get(alteration.entity) ?? {
      entity: alteration.entity,
      rawName: alteration.rawName,
      fields: [],
    };
    tables.set(alteration.entity, existing);

    for (const field of alteration.fields) {
      const index = existing.fields.findIndex((item) => item.name === field.name);
      if (field.removed) {
        if (index !== -1) existing.fields.splice(index, 1);
      } else if (index === -1) {
        existing.fields.push(field);
      }
    }
  }

  output.migrations.push(...tables.values());
}

function stripSqlComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

function parseCreateTables(content: string, file: string): MigrationTable[] {
  const tables: MigrationTable[] = [];
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const rawTable = match[1];
    if (!rawTable) continue;
    const openIndex = regex.lastIndex - 1;
    const closeIndex = matchingParenthesis(content, openIndex);
    if (closeIndex === -1) continue;

    const rawName = unquoteIdentifier(rawTable);
    const body = content.slice(openIndex + 1, closeIndex);
    const fields: MigrationField[] = [];

    for (const definition of splitTopLevel(body)) {
      const field = parseColumnDefinition(definition, file, lineAt(content, openIndex));
      if (field) fields.push(field);
    }

    tables.push({ entity: normalizeEntityName(rawName), rawName, fields });
    regex.lastIndex = closeIndex + 1;
  }

  return tables;
}

interface Alteration {
  entity: string;
  rawName: string;
  fields: MigrationField[];
}

function parseAlterTables(content: string, file: string): Alteration[] {
  const alterations: Alteration[] = [];
  const regex =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s]+)\s+(ADD|DROP)\s+(?:COLUMN\s+)?([^;]+);?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const rawTable = match[1];
    const action = match[2]?.toUpperCase();
    const rest = (match[3] ?? '').replace(/^\s*IF\s+NOT\s+EXISTS\s+/i, '');
    if (!rawTable || !action || !rest) continue;

    const rawName = unquoteIdentifier(rawTable);
    const entity = normalizeEntityName(rawName);
    const line = lineAt(content, match.index);
    const fields: MigrationField[] = [];

    if (action === 'DROP') {
      const name = unquoteIdentifier(rest.trim().split(/\s+/)[0] ?? '');
      if (name) {
        fields.push({
          name: normalizeFieldName(name),
          rawName: name,
          rawType: null,
          ref: ref(file, line),
          removed: true,
        });
      }
    } else {
      // ADD COLUMN x TYPE ... — aceita múltiplas colunas separadas por vírgula.
      for (const definition of splitTopLevel(rest)) {
        const field = parseColumnDefinition(definition, file, line);
        if (field) fields.push(field);
      }
    }

    alterations.push({ entity, rawName, fields });
  }

  return alterations;
}

function parseColumnDefinition(
  definition: string,
  file: string,
  line: number,
): MigrationField | null {
  let trimmed = definition.trim();
  // Em ALTER TABLE com múltiplas colunas, cada item depois da vírgula repete
  // "ADD COLUMN IF NOT EXISTS"; removemos para não criar a coluna "ADD".
  trimmed = trimmed
    .replace(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?/i, '')
    .replace(/^IF\s+NOT\s+EXISTS\s+/i, '');
  if (trimmed.length === 0) return null;
  if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|KEY|INDEX|EXCLUDE)\b/i.test(trimmed)) {
    return null;
  }

  const match = /^([`"\w.]+)\s+([A-Za-z][\w]*(?:\s*\([^)]*\))?(?:\[\])?)/.exec(trimmed);
  if (!match?.[1] || !match[2]) return null;
  const rawName = unquoteIdentifier(match[1]);
  if (rawName.toLowerCase() === 'constraint') return null;

  return {
    name: normalizeFieldName(rawName),
    rawName,
    rawType: match[2].trim(),
    ref: ref(file, line),
    removed: false,
  };
}

function matchingParenthesis(content: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

function lineAt(content: string, index: number | undefined): number {
  if (index === undefined || index < 0) return 1;
  return content.slice(0, index).split(/\r?\n/).length;
}

function unquoteIdentifier(value: string): string {
  return (
    value
      .replace(/[`"[\]]/g, '')
      .split('.')
      .pop() ?? value
  );
}
