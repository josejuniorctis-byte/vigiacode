import ts from 'typescript';
import { normalizeEntityName } from '../names.js';
import { classifyFile, extensionOf } from '../classify.js';
import {
  emptyFileExtract,
  HTTP_METHODS,
  type EndpointInfo,
  type EntityInfo,
  type FileExtract,
  type HttpMethod,
  type LayerExtractor,
} from '../types.js';
import { lineOf, parseSource, stringValue } from './ast.js';
import {
  addEntity,
  addField,
  entityFromRoutePath,
  guessEntityFromPath,
  makeField,
  normalizeRoutePath,
  ref,
} from './common.js';

const ROUTE_OWNERS = new Set(['app', 'router', 'server', 'fastify', 'route', 'routes', 'api']);
const DTO_NAME = /(Dto|DTO|Request|Response|Input|Payload|Entity|Model|Schema|Form)$/;
const IGNORED_TYPE =
  /^(FastifyRequest|FastifyReply|FastifyInstance|Request|Response|NextRequest|NextResponse|IncomingMessage|ServerResponse|JwtPayload|RouteOptions|RouteHandler|RouteGenericInterface|Server|Application|Context|Props|State|Config|Options)$/;

/**
 * Extrai do back-end:
 * - rotas Express, Fastify, Nest, Next API routes, Spring e FastAPI;
 * - DTOs TS (interface/type/class/zod), Java (class/record) e Python (pydantic).
 */
export const backendExtractor: LayerExtractor = {
  name: 'backend',
  layer: 'backend',
  supports(file, content) {
    return classifyFile(file, content).includes('backend');
  },
  extract({ file, content }): FileExtract {
    const output = emptyFileExtract(file, 'backend', 'backend');
    const extension = extensionOf(file);

    if (['.java', '.kt'].includes(extension)) {
      extractJava(file, content, output);
      return output;
    }
    if (extension === '.py') {
      extractPython(file, content, output);
      return output;
    }
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(extension)) {
      extractTypeScript(file, content, output);
      return output;
    }

    return output;
  },
};

function extractTypeScript(file: string, content: string, output: FileExtract): void {
  const sourceFile = parseSource(file, content);
  const routeEntities = new Set<string>();

  // Primeira passada: rotas (para saber quais tipos são DTOs).
  const endpoints: EndpointInfo[] = [];
  collectRoutes(sourceFile, file, endpoints);
  collectNestRoutes(sourceFile, file, endpoints);
  collectNextRoutes(file, sourceFile, endpoints);

  for (const endpoint of endpoints) routeEntities.add(endpoint.entity);
  output.endpoints.push(...endpoints);

  const fileEntity = guessEntityFromPath(file);
  const ensureEntity = (rawName: string, line: number, source: string): EntityInfo | null => {
    if (IGNORED_TYPE.test(rawName)) return null;
    return addEntity(output.entities, 'backend', rawName, ref(file, line), source);
  };

  // Entidades que existem como rota, mesmo sem DTO explícito.
  for (const endpoint of endpoints) {
    ensureEntity(endpoint.entity, endpoint.ref.line, 'route');
  }

  // Segunda passada: DTOs, imports, definições e JSX (R7 também vale no back).
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = [];
      const clause = node.importClause;
      if (clause?.name) names.push(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) names.push(element.name.text);
      }
      output.imports.push({
        file,
        line: lineOf(sourceFile, node),
        specifier: node.moduleSpecifier.text,
        names,
        relative: node.moduleSpecifier.text.startsWith('.'),
      });
    }

    if (ts.isInterfaceDeclaration(node)) {
      maybeAddDto(node.name.text, lineOf(sourceFile, node), 'dto', () => {
        const entity = ensureEntity(node.name.text, lineOf(sourceFile, node), 'dto');
        if (!entity) return;
        for (const member of node.members) {
          if (!ts.isPropertySignature(member) || !member.name) continue;
          const rawName = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
          if (rawName.length === 0) continue;
          addField(
            entity,
            makeField({
              rawName,
              rawType: member.type?.getText(sourceFile) ?? null,
              optional: Boolean(member.questionToken),
              ref: ref(file, lineOf(sourceFile, member)),
              source: 'dto',
            }),
          );
        }
      });
    }

    if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      const aliasName = node.name.text;
      const typeNode = node.type;
      maybeAddDto(aliasName, lineOf(sourceFile, node), 'dto', () => {
        const entity = ensureEntity(aliasName, lineOf(sourceFile, node), 'dto');
        if (!entity) return;
        for (const member of typeNode.members) {
          if (!ts.isPropertySignature(member) || !member.name) continue;
          const rawName = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
          addField(
            entity,
            makeField({
              rawName,
              rawType: member.type?.getText(sourceFile) ?? null,
              optional: Boolean(member.questionToken),
              ref: ref(file, lineOf(sourceFile, member)),
              source: 'dto',
            }),
          );
        }
      });
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      output.definitions.push(className);
      maybeAddDto(className, lineOf(sourceFile, node), 'dto', () => {
        const entity = ensureEntity(className, lineOf(sourceFile, node), 'dto');
        if (!entity) return;
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || !member.name) continue;
          const rawName = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
          addField(
            entity,
            makeField({
              rawName,
              rawType: member.type?.getText(sourceFile) ?? null,
              optional: Boolean(member.questionToken),
              ref: ref(file, lineOf(sourceFile, member)),
              source: 'dto',
            }),
          );
        }
      });
    }

    if (ts.isFunctionDeclaration(node) && node.name) output.definitions.push(node.name.text);

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const variableName = node.name.text;
      output.definitions.push(variableName);
      const dto = zodDto(node);
      if (dto) {
        maybeAddDto(variableName, lineOf(sourceFile, node), 'dto', () => {
          const entity = ensureEntity(variableName, lineOf(sourceFile, node), 'dto');
          if (!entity) return;
          for (const field of dto) {
            addField(
              entity,
              makeField({
                rawName: field.name,
                rawType: field.type,
                optional: field.optional,
                ref: ref(file, lineOf(sourceFile, node)),
                source: 'dto',
              }),
            );
          }
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  function maybeAddDto(rawName: string, line: number, _source: string, add: () => void): void {
    if (IGNORED_TYPE.test(rawName)) return;
    const entity = normalizeEntityName(rawName);
    const isDto = DTO_NAME.test(rawName);
    const isKnown = routeEntities.has(entity) || fileEntity === entity;
    if (!isDto && !isKnown) return;
    void line;
    add();
  }
}

function collectRoutes(sourceFile: ts.SourceFile, file: string, endpoints: EndpointInfo[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression.getText(sourceFile).toLowerCase();
      const verb = node.expression.name.text.toUpperCase();

      if (ROUTE_OWNERS.has(owner) && (HTTP_METHODS as readonly string[]).includes(verb)) {
        const rawPath = stringValue(node.arguments[0]);
        if (rawPath) {
          endpoints.push(endpoint(file, node, sourceFile, verb as HttpMethod, rawPath, 'express'));
        }
      }

      if (owner === 'fastify' && node.expression.name.text === 'route') {
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          const method = options.properties.find(
            (property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) &&
              property.name.getText(sourceFile).toLowerCase() === 'method',
          );
          const url = options.properties.find(
            (property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) &&
              property.name.getText(sourceFile).toLowerCase() === 'url',
          );
          const methodValue = stringValue(method?.initializer);
          const urlValue = stringValue(url?.initializer);
          if (methodValue && urlValue) {
            endpoints.push(
              endpoint(
                file,
                node,
                sourceFile,
                methodValue.toUpperCase() as HttpMethod,
                urlValue,
                'fastify',
              ),
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectNestRoutes(
  sourceFile: ts.SourceFile,
  file: string,
  endpoints: EndpointInfo[],
): void {
  const visit = (node: ts.Node): void => {
    if (!ts.isClassDeclaration(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const controller = decoratorArgument(sourceFile, node, 'Controller');
    if (controller === null || controller === undefined) {
      ts.forEachChild(node, visit);
      return;
    }

    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      for (const method of HTTP_METHODS) {
        const arg = decoratorArgument(sourceFile, member, nestDecoratorName(method));
        if (arg === null || arg === undefined) continue;
        const path = joinRoutePaths(controller, arg);
        endpoints.push({
          method,
          path,
          rawPath: path,
          entity: entityFromRoutePath(path),
          ref: ref(file, lineOf(sourceFile, member)),
          source: 'nest',
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function nestDecoratorName(method: HttpMethod): string {
  switch (method) {
    case 'GET':
      return 'Get';
    case 'POST':
      return 'Post';
    case 'PUT':
      return 'Put';
    case 'PATCH':
      return 'Patch';
    case 'DELETE':
      return 'Delete';
    default:
      return method[0] + method.slice(1).toLowerCase();
  }
}

function decoratorArgument(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  decoratorName: string,
): string | null | undefined {
  if (!ts.canHaveDecorators(node)) return undefined;
  const decorators = ts.getDecorators(node) ?? [];
  for (const decorator of decorators) {
    const expression = decorator.expression;
    const name = ts.isCallExpression(expression)
      ? expression.expression.getText(sourceFile)
      : expression.getText(sourceFile);
    if (name !== decoratorName) continue;
    if (!ts.isCallExpression(expression)) return '';
    return stringValue(expression.arguments[0]) ?? '';
  }
  return undefined;
}

function collectNextRoutes(
  file: string,
  sourceFile: ts.SourceFile,
  endpoints: EndpointInfo[],
): void {
  const normalized = file.replaceAll('\\', '/').toLowerCase();
  if (!/(^|\/)(pages|app)\/api\//.test(normalized) && !/^api\//.test(normalized)) return;

  const basePath = nextRoutePath(file);
  if (!basePath) return;

  const exported = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) exported.add(node.name.text.toUpperCase());
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      exported.add(node.name.text.toUpperCase());
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const methods = HTTP_METHODS.filter((method) => exported.has(method));
  if (methods.length === 0) {
    const hasDefault =
      sourceFile.statements.some(
        (statement) =>
          ts.isExportAssignment(statement) ||
          (ts.isExportDeclaration(statement) && statement.exportClause === undefined),
      ) || /export\s+default/.test(sourceFile.getText(sourceFile));
    if (hasDefault) {
      methods.push('GET', 'POST');
    }
  }

  for (const method of methods) {
    endpoints.push({
      method,
      path: basePath,
      rawPath: basePath,
      entity: entityFromRoutePath(basePath),
      ref: ref(file, 1),
      source: 'next',
    });
  }
}

function nextRoutePath(file: string): string | null {
  const segments = file.replaceAll('\\', '/').split('/');
  const apiIndex = segments.findIndex((segment) => segment.toLowerCase() === 'api');
  if (apiIndex === -1) return null;

  const rest = segments.slice(apiIndex + 1);
  const last = rest[rest.length - 1] ?? '';
  const lastWithoutExtension = last.replace(/\.[^.]+$/, '');
  if (['index', 'route'].includes(lastWithoutExtension.toLowerCase())) rest.pop();

  const path = rest
    .map((segment) => {
      const clean = segment.replace(/\.[^.]+$/, '');
      if (/^\[\.\.\..+\]$/.test(clean) || /^\[.+\]$/.test(clean)) return ':param';
      return clean;
    })
    .filter(Boolean)
    .join('/');

  return normalizeRoutePath(`/api/${path}`);
}

function endpoint(
  file: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  method: HttpMethod,
  rawPath: string,
  source: string,
): EndpointInfo {
  const path = normalizeRoutePath(rawPath);
  return {
    method,
    path,
    rawPath,
    entity: entityFromRoutePath(path),
    ref: ref(file, lineOf(sourceFile, node)),
    source,
  };
}

interface ZodField {
  name: string;
  type: string;
  optional: boolean;
}

function zodDto(node: ts.VariableDeclaration): ZodField[] | null {
  if (!ts.isIdentifier(node.name)) return null;
  const initializer = node.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  const callee = initializer.expression.getText();
  if (!/(?:^|\.)object$/.test(callee)) return null;
  const argument = initializer.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;

  const fields: ZodField[] = [];
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    const name = property.name.getText().replace(/^['"]|['"]$/g, '');
    const type = property.initializer.getText();
    fields.push({
      name,
      type,
      optional: /\.(optional|nullish)\(\)/.test(type),
    });
  }
  return fields;
}

/** Java/Spring: controllers, @RequestMapping e DTOs (class/record). */
function extractJava(file: string, content: string, output: FileExtract): void {
  const lines = content.split(/\r?\n/);
  const baseMatch = /@RequestMapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']*)["']/.exec(
    content,
  );
  const base = baseMatch?.[1] ?? '';

  for (const [index, line] of lines.entries()) {
    const methodMatch =
      /@(Get|Post|Put|Patch|Delete)Mapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']*)["'])?/.exec(
        line,
      );
    if (methodMatch) {
      const verb = methodMatch[1]?.toUpperCase() as HttpMethod;
      const path = joinRoutePaths(base, methodMatch[2] ?? '');
      output.endpoints.push({
        method: verb,
        path,
        rawPath: path,
        entity: entityFromRoutePath(path),
        ref: ref(file, index + 1),
        source: 'spring',
      });
    }
  }

  const recordMatches = content.matchAll(/(?:public\s+)?record\s+(\w+)\s*\(([^)]*)\)/g);
  for (const match of recordMatches) {
    const name = match[1];
    if (!name || !isDtoEntity(name, output.endpoints)) continue;
    const entity = addEntity(
      output.entities,
      'backend',
      name,
      ref(file, lineOfIndex(content, match.index)),
      'dto',
    );
    if (!entity) continue;
    for (const part of (match[2] ?? '').split(',')) {
      const fieldMatch = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*([\w.<>, ?]+?)\s+(\w+)\s*$/.exec(part);
      if (!fieldMatch?.[1] || !fieldMatch[2]) continue;
      addField(
        entity,
        makeField({
          rawName: fieldMatch[2],
          rawType: fieldMatch[1],
          ref: ref(file, lineOfIndex(content, match.index)),
          source: 'dto',
        }),
      );
    }
  }

  const classMatches = content.matchAll(
    /(?:public\s+|final\s+)*class\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g,
  );
  for (const match of classMatches) {
    const name = match[1];
    if (!name || !isDtoEntity(name, output.endpoints)) continue;
    const entity = addEntity(
      output.entities,
      'backend',
      name,
      ref(file, lineOfIndex(content, match.index)),
      'dto',
    );
    if (!entity) continue;

    const body = match[2] ?? '';
    const fieldRegex =
      /^\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:private|protected|public)\s+(?:final\s+)?([\w.<>, ?]+?)\s+(\w+)\s*(?:=[^;]*)?;/gm;
    for (const fieldMatch of body.matchAll(fieldRegex)) {
      const type = fieldMatch[1];
      const fieldName = fieldMatch[2];
      if (!type || !fieldName) continue;
      if (fieldName === name) continue;
      addField(
        entity,
        makeField({
          rawName: fieldName,
          rawType: type,
          ref: ref(file, lineOfIndex(content, match.index)),
          source: 'dto',
        }),
      );
    }
  }
}

/** Python/FastAPI: rotas e modelos pydantic. */
function extractPython(file: string, content: string, output: FileExtract): void {
  const lines = content.split(/\r?\n/);
  const prefixMatch = /APIRouter\s*\(\s*prefix\s*=\s*["']([^"']+)["']/.exec(content);
  const prefix = prefixMatch?.[1] ?? '';

  let currentClass: string | null = null;
  let currentIsDto = false;
  let currentEntity: EntityInfo | null = null;

  for (const [index, line] of lines.entries()) {
    const routeMatch =
      /^\s*@(?:app|router|api)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']*)["']/.exec(line);
    if (routeMatch) {
      const method = routeMatch[1]?.toUpperCase() as HttpMethod;
      const path = joinRoutePaths(prefix, routeMatch[2] ?? '');
      output.endpoints.push({
        method,
        path,
        rawPath: path,
        entity: entityFromRoutePath(path),
        ref: ref(file, index + 1),
        source: 'fastapi',
      });
    }

    const classMatch = /^\s*class\s+(\w+)\s*\(([^)]*)\)\s*:/.exec(line);
    if (classMatch) {
      currentClass = classMatch[1] ?? null;
      const bases = classMatch[2] ?? '';
      currentIsDto = /BaseModel/.test(bases) && !/Base\b/.test(bases);
      currentEntity =
        currentIsDto && currentClass && isDtoEntity(currentClass, output.endpoints)
          ? addEntity(output.entities, 'backend', currentClass, ref(file, index + 1), 'dto')
          : null;
      continue;
    }

    if (currentClass && /^\S/.test(line) && !line.startsWith('#')) {
      currentClass = null;
      currentEntity = null;
      currentIsDto = false;
    }

    if (currentEntity && /^\s+\w+\s*:/.test(line)) {
      const fieldMatch = /^\s+(\w+)\s*:\s*([^=#]+?)(?:\s*=\s*(.+))?$/.exec(line);
      if (fieldMatch?.[1] && fieldMatch[2]) {
        const rawType = fieldMatch[2].trim();
        const defaultText = fieldMatch[3]?.trim() ?? '';
        addField(
          currentEntity,
          makeField({
            rawName: fieldMatch[1],
            rawType,
            optional:
              /Optional\[|\|\s*None/.test(rawType) ||
              defaultText.startsWith('None') ||
              (defaultText.startsWith('Field(') && /default\s*=\s*None/.test(defaultText)),
            ref: ref(file, index + 1),
            source: 'dto',
          }),
        );
      }
    }
  }
}

function isDtoEntity(rawName: string, endpoints: EndpointInfo[]): boolean {
  if (IGNORED_TYPE.test(rawName)) return false;
  if (
    /(Controller|Service|Repository|Router|Handler|Endpoint|Client|Config|Application)$/.test(
      rawName,
    )
  ) {
    return false;
  }
  if (DTO_NAME.test(rawName)) return true;
  const entity = normalizeEntityName(rawName);
  return endpoints.some((endpoint) => endpoint.entity === entity);
}

function joinRoutePaths(base: string, path: string): string {
  const cleanBase = base.trim();
  const cleanPath = path.trim();
  if (cleanPath.length === 0) return normalizeRoutePath(cleanBase.length > 0 ? cleanBase : '/');
  if (cleanBase.length === 0) return normalizeRoutePath(cleanPath);
  if (cleanPath.startsWith(cleanBase)) return normalizeRoutePath(cleanPath);
  const separator = cleanBase.endsWith('/') || cleanPath.startsWith('/') ? '' : '/';
  return normalizeRoutePath(`${cleanBase}${separator}${cleanPath}`);
}

function lineOfIndex(content: string, index: number | undefined): number {
  if (index === undefined || index < 0) return 1;
  return content.slice(0, index).split(/\r?\n/).length;
}
