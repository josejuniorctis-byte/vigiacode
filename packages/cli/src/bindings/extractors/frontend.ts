import ts from 'typescript';
import {
  emptyFileExtract,
  HTTP_METHODS,
  type EntityInfo,
  type FileExtract,
  type FrontendCall,
  type HttpMethod,
  type LayerExtractor,
  type RouteInfo,
} from '../types.js';
import { classifyFile, extensionOf } from '../classify.js';
import { lineOf, parseSource, stringValue, typeArgumentName } from './ast.js';
import {
  addEntity,
  addField,
  entityFromRoutePath,
  guessEntityFromPath,
  isMockFile,
  makeField,
  normalizeRoutePath,
  ref,
} from './common.js';

const HTTP_CLIENTS = new Set(['axios', 'ky', 'http', 'api', 'client', 'apiclient', 'httpclient']);

/**
 * Extrai do front-end:
 * - tipos/interfaces (entidades e campos);
 * - campos de formulário (`name=`, `register()`, `v-model`);
 * - chamadas HTTP (fetch/axios/ky) e payloads;
 * - rotas/páginas, imports e componentes usados;
 * - uso de mocks e localStorage.
 */
export const frontendExtractor: LayerExtractor = {
  name: 'frontend',
  layer: 'frontend',
  supports(file, content) {
    return classifyFile(file, content).includes('frontend');
  },
  extract({ file, content }): FileExtract {
    const output = emptyFileExtract(file, 'frontend', 'frontend');
    output.mockFile = isMockFile(file);
    output.localStorage = /\blocalStorage\b/.test(content);

    const extension = extensionOf(file);
    if (['.vue', '.svelte', '.astro'].includes(extension)) {
      extractVueLike(file, content, output);
      return output;
    }

    const sourceFile = parseSource(file, content);
    const fileEntity = guessEntityFromPath(file);
    const formEntity: string | null = findFormEntity(sourceFile) ?? fileEntity;

    const ensureEntity = (rawName: string, line: number, source: string): EntityInfo | null =>
      addEntity(output.entities, 'frontend', rawName, ref(file, line), source);

    const addFormField = (rawName: string, line: number): void => {
      const entity = formEntity ? ensureEntity(formEntity, line, 'form') : null;
      if (!entity) return;
      addField(
        entity,
        makeField({
          rawName,
          rawType: null,
          ref: ref(file, line),
          source: 'form',
        }),
      );
    };

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const names: string[] = [];
        const clause = node.importClause;
        if (clause) {
          if (clause.name) names.push(clause.name.text);
          if (clause.namedBindings) {
            if (ts.isNamedImports(clause.namedBindings)) {
              for (const element of clause.namedBindings.elements) {
                names.push(element.name.text);
              }
            } else if (ts.isNamespaceImport(clause.namedBindings)) {
              names.push(clause.namedBindings.name.text);
            }
          }
        }
        const specifier = node.moduleSpecifier.text;
        output.imports.push({
          file,
          line: lineOf(sourceFile, node),
          specifier,
          names,
          relative: specifier.startsWith('.'),
        });
      }

      if (ts.isInterfaceDeclaration(node)) {
        const entity = ensureEntity(node.name.text, lineOf(sourceFile, node), 'type');
        if (entity) {
          for (const member of node.members) {
            addTypeMember(entity, member, sourceFile, file);
          }
        }
      }

      if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
        const entity = ensureEntity(node.name.text, lineOf(sourceFile, node), 'type');
        if (entity) {
          for (const member of node.type.members) {
            addTypeMember(entity, member, sourceFile, file);
          }
        }
      }

      if (ts.isClassDeclaration(node) && node.name) {
        output.definitions.push(node.name.text);
        decodeClassProperties(node, sourceFile, file, ensureEntity, node.name.text);
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        output.definitions.push(node.name.text);
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        output.definitions.push(node.name.text);
      }

      if (ts.isCallExpression(node)) {
        handleCall(node, sourceFile, file, ensureEntity, addFormField, output);
      }

      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(sourceFile);
        if (name === 'name' && !isUiOnlyInput(node, sourceFile)) {
          const value = stringValue(node.initializer);
          if (value) addFormField(value, lineOf(sourceFile, node));
        }
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        if (tagName.length > 0 && /^[A-Z]/.test(tagName)) {
          output.jsx.push({ file, line: lineOf(sourceFile, node), name: tagName });
        }

        if (tagName === 'Route') {
          const route = routeFromJsx(node, sourceFile, file);
          if (route) output.routes.push(route);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return output;
  },
};

/** Radio/checkbox/botões têm `name` de grupo de UI, não campo de formulário. */
function isUiOnlyInput(node: ts.JsxAttribute, sourceFile: ts.SourceFile): boolean {
  const element: ts.Node | undefined = node.parent?.parent;
  if (!element) return false;
  if (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element)) return false;
  if (element.tagName.getText(sourceFile).toLowerCase() !== 'input') return false;

  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText(sourceFile) !== 'type') continue;
    const type = stringValue(attribute.initializer)?.toLowerCase();
    if (type && ['radio', 'checkbox', 'button', 'submit', 'reset', 'image'].includes(type)) {
      return true;
    }
  }
  return false;
}

function findFormEntity(sourceFile: ts.SourceFile): string | null {
  let found: string | null = null;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      (node.expression.getText(sourceFile) === 'useForm' ||
        node.expression.getText(sourceFile) === 'Form') &&
      node.typeArguments?.[0]
    ) {
      found = typeArgumentName(sourceFile, node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function addTypeMember(
  entity: EntityInfo,
  member: ts.TypeElement,
  sourceFile: ts.SourceFile,
  file: string,
): void {
  if (!ts.isPropertySignature(member) || !member.name) return;
  const rawName = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
  if (rawName.length === 0) return;
  if (/^on[A-Z]/.test(rawName)) return;
  if (['children', 'className', 'style', 'key', 'ref'].includes(rawName)) return;
  if (member.type && ts.isFunctionTypeNode(member.type)) return;

  const rawType = member.type?.getText(sourceFile) ?? null;
  addField(
    entity,
    makeField({
      rawName,
      rawType,
      optional: Boolean(member.questionToken),
      ref: ref(file, lineOf(sourceFile, member)),
      source: 'type',
    }),
  );
}

function decodeClassProperties(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  file: string,
  ensureEntity: (name: string, line: number, source: string) => EntityInfo | null,
  rawName: string,
): void {
  const entity = ensureEntity(rawName, lineOf(sourceFile, node), 'type');
  if (!entity) return;

  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || !member.name) continue;
    const fieldName = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
    if (fieldName.length === 0) continue;
    addField(
      entity,
      makeField({
        rawName: fieldName,
        rawType: member.type?.getText(sourceFile) ?? null,
        optional: Boolean(member.questionToken),
        ref: ref(file, lineOf(sourceFile, member)),
        source: 'type',
      }),
    );
  }
}

function handleCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  file: string,
  ensureEntity: (name: string, line: number, source: string) => EntityInfo | null,
  addFormField: (name: string, line: number) => void,
  output: FileExtract,
): void {
  const expression = node.expression;
  const line = lineOf(sourceFile, node);
  const calleeText = expression.getText(sourceFile);

  if (
    calleeText === 'register' ||
    calleeText.endsWith('.register') ||
    calleeText.endsWith('.setValue')
  ) {
    const value = stringValue(node.arguments[0]);
    if (value) addFormField(value, line);
  }

  if (calleeText.endsWith('.append') && node.arguments[0]) {
    const owner = ts.isPropertyAccessExpression(expression)
      ? expression.expression.getText(sourceFile).toLowerCase()
      : '';
    if (owner.includes('formdata')) {
      const value = stringValue(node.arguments[0]);
      if (value) addFormField(value, line);
    }
  }

  const call = detectHttpCall(node, sourceFile, file);
  if (!call) return;

  output.calls.push(call);

  // Campos enviados no body/payload também contam como uso no front-end.
  const payloadNode = findPayloadNode(node, sourceFile, call.source);
  if (!payloadNode) return;

  const entity = ensureEntity(call.entity, line, 'payload');
  if (!entity) return;
  for (const key of payloadKeys(payloadNode, sourceFile)) {
    addField(
      entity,
      makeField({ rawName: key, rawType: null, ref: ref(file, line), source: 'payload' }),
    );
  }
}

/**
 * Extrai a parte literal de uma URL montada com `+`
 * (`base + "/api/users"` → `/api/users`). Variáveis são descartadas.
 */
function urlValue(node: ts.Node | undefined): string | null {
  if (!node) return null;
  const direct = stringValue(node);
  if (direct !== null) return direct;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = urlValue(node.left) ?? '';
    const right = urlValue(node.right) ?? '';
    return left + right || null;
  }
  if (ts.isParenthesizedExpression(node)) return urlValue(node.expression);
  return null;
}

function detectHttpCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  file: string,
): FrontendCall | null {
  const expression = node.expression;
  const line = lineOf(sourceFile, node);

  let method: HttpMethod = 'GET';
  let urlNode: ts.Expression | undefined = node.arguments[0];
  let source: string | null = null;

  if (ts.isIdentifier(expression) && expression.text === 'fetch') {
    source = 'fetch';
    const options = node.arguments[1];
    if (options && ts.isObjectLiteralExpression(options)) {
      const methodProperty = options.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(sourceFile).toLowerCase() === 'method',
      );
      const value = stringValue(methodProperty?.initializer);
      if (value && (HTTP_METHODS as readonly string[]).includes(value.toUpperCase())) {
        method = value.toUpperCase() as HttpMethod;
      }
    }
  } else if (ts.isPropertyAccessExpression(expression)) {
    const owner = expression.expression.getText(sourceFile).toLowerCase();
    const verb = expression.name.text.toUpperCase();
    if (HTTP_CLIENTS.has(owner) && (HTTP_METHODS as readonly string[]).includes(verb)) {
      source = owner;
      method = verb as HttpMethod;
    }
  } else if (ts.isIdentifier(expression) && expression.text === 'axios') {
    const options = node.arguments[0];
    if (options && ts.isObjectLiteralExpression(options)) {
      source = 'axios';
      const urlProperty = options.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(sourceFile).toLowerCase() === 'url',
      );
      urlNode = urlProperty?.initializer;
      const methodProperty = options.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(sourceFile).toLowerCase() === 'method',
      );
      const value = stringValue(methodProperty?.initializer);
      if (value && (HTTP_METHODS as readonly string[]).includes(value.toUpperCase())) {
        method = value.toUpperCase() as HttpMethod;
      }
    }
  }

  if (!source || !urlNode) return null;
  const rawPath = urlValue(urlNode);
  if (!rawPath || rawPath.length === 0) return null;
  if (/^https?:\/\//i.test(rawPath) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(rawPath)) {
    return null;
  }
  if (!rawPath.startsWith('/') && !rawPath.includes('/api/') && !rawPath.startsWith('api/')) {
    return null;
  }

  const path = normalizeRoutePath(rawPath);
  return {
    method,
    path,
    rawPath,
    entity: entityFromRoutePath(path),
    ref: ref(file, line),
    source,
  };
}

function findPayloadNode(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  _source: string,
): ts.Node | undefined {
  for (const argument of node.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    const property = argument.properties.find(
      (item): item is ts.PropertyAssignment =>
        ts.isPropertyAssignment(item) &&
        ['body', 'data', 'params'].includes(item.name.getText(sourceFile).toLowerCase()),
    );
    if (!property) continue;

    let value: ts.Expression = property.initializer;
    if (ts.isCallExpression(value)) {
      value = value.arguments[0] ?? value;
    }
    return value;
  }
  return undefined;
}

function payloadKeys(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  if (!ts.isObjectLiteralExpression(node)) return [];
  const keys: string[] = [];
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const name = property.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
      if (name.length > 0) keys.push(name);
    }
  }
  return keys;
}

function routeFromJsx(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
  file: string,
): RouteInfo | null {
  let path: string | null = null;
  let component: string | null = null;

  for (const attribute of node.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText(sourceFile);
    if (name === 'path') {
      path = stringValue(attribute.initializer);
    }
    if (name === 'component' && attribute.initializer) {
      component = attribute.initializer.getText(sourceFile).replace(/[{}]/g, '').trim();
    }
    if (name === 'element' && attribute.initializer) {
      const text = attribute.initializer.getText(sourceFile);
      const match = /<\s*([A-Z][A-Za-z0-9_.]*)/.exec(text);
      if (match?.[1]) component = match[1];
    }
  }

  if (!path) return null;
  return { path: normalizeRoutePath(path), component, ref: ref(file, lineOf(sourceFile, node)) };
}

/** Parser leve para .vue/.svelte/.astro (o TS AST não entende SFC). */
function extractVueLike(file: string, content: string, output: FileExtract): void {
  const lines = content.split(/\r?\n/);
  const entityName = guessEntityFromPath(file);

  const ensureEntity = (rawName: string, line: number, source: string): EntityInfo | null =>
    addEntity(output.entities, 'frontend', rawName, ref(file, line), source);

  const addFormField = (rawName: string, line: number): void => {
    if (!entityName) return;
    const entity = ensureEntity(entityName, line, 'form');
    if (entity) {
      addField(entity, makeField({ rawName, rawType: null, ref: ref(file, line), source: 'form' }));
    }
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const nameAttribute = /\bname=["']([A-Za-z_$][\w$]*)["']/.exec(line);
    if (nameAttribute?.[1]) addFormField(nameAttribute[1], lineNumber);

    const register = /\bregister\(\s*["']([^"']+)["']/.exec(line);
    if (register?.[1]) addFormField(register[1], lineNumber);

    const vModel = /\bv-model=["'](?:[\w$]+\.)?([A-Za-z_$][\w$]*)["']/.exec(line);
    if (vModel?.[1]) addFormField(vModel[1], lineNumber);

    const call =
      /\b(?:fetch|axios\.(get|post|put|patch|delete)|ky\.(get|post|put|patch|delete)|http\.(get|post|put|patch|delete))\(\s*["'`]([^"'`]+)["'`]/.exec(
        line,
      );
    if (call) {
      const method = (call[1] ?? 'GET').toUpperCase() as HttpMethod;
      const path = normalizeRoutePath(call[2] ?? '');
      const entity = ensureEntity(entityFromRoutePath(path), lineNumber, 'payload');
      output.calls.push({
        method,
        path,
        rawPath: call[2] ?? '',
        entity: entityFromRoutePath(path),
        ref: ref(file, lineNumber),
        source: 'fetch',
      });
      if (entity) {
        for (const key of payloadKeysFromText(line)) {
          addField(
            entity,
            makeField({
              rawName: key,
              rawType: null,
              ref: ref(file, lineNumber),
              source: 'payload',
            }),
          );
        }
      }
    }

    const importMatch = /\bfrom\s+["'](\.[^"']+)["']/.exec(line);
    if (importMatch?.[1]) {
      output.imports.push({
        file,
        line: lineNumber,
        specifier: importMatch[1],
        names: [],
        relative: true,
      });
    }
  }
}

function payloadKeysFromText(line: string): string[] {
  const match = /\{([^{}]*)\}/.exec(line);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((part) => part.split(':')[0]?.trim() ?? '')
    .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
}
