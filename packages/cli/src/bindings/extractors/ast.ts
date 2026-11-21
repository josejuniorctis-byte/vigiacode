import ts from 'typescript';

/** Utilidades compartilhadas pelos extractors que usam a TypeScript compiler API. */

export function scriptKindFor(file: string): ts.ScriptKind {
  const lower = file.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export function parseSource(file: string, content: string): ts.SourceFile {
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKindFor(file));
}

export function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function stringValue(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      value += `\${${span.expression.getText()}}${span.literal.text}`;
    }
    return value;
  }
  return null;
}

export function propertyName(node: ts.PropertyName | ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

export function objectLiteralProperties(
  node: ts.ObjectLiteralExpression,
): Array<{ name: string; node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment }> {
  const result: Array<{
    name: string;
    node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment;
  }> = [];
  for (const property of node.properties) {
    const name = propertyName(property.name);
    if (!name) continue;
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      result.push({ name, node: property });
    }
  }
  return result;
}

export function findProperty(
  node: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  return objectLiteralProperties(node).find(
    (property) => property.name.toLowerCase() === name.toLowerCase(),
  )?.node;
}

/** Extrai o nome do tipo de um argumento genérico: useForm<User>() → User. */
export function typeArgumentName(
  sourceFile: ts.SourceFile,
  node: ts.CallExpression | ts.NewExpression,
): string | null {
  const typeArgument = node.typeArguments?.[0];
  if (!typeArgument) return null;
  return typeArgument.getText(sourceFile).replace(/<.*>$/, '').split('.').pop() ?? null;
}

/** Coleta nomes de propriedades de um object literal (body de payload). */
export function objectKeys(node: ts.Node | undefined): Array<{ name: string; line: number }> {
  if (!node) return [];
  let object: ts.ObjectLiteralExpression | undefined;
  if (ts.isObjectLiteralExpression(node)) object = node;
  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    const first = node.arguments[0];
    if (first && ts.isObjectLiteralExpression(first)) object = first;
  }
  if (ts.isParenthesizedExpression(node) && ts.isObjectLiteralExpression(node.expression)) {
    object = node.expression;
  }
  if (!object) return [];
  return objectLiteralProperties(object).map((property) => ({
    name: property.name,
    line: 0,
  }));
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** Nome de uma declaração de classe/função/variável. */
export function declarationName(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text ?? null;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

export function isFunctionLike(node: ts.TypeNode | undefined): boolean {
  if (!node) return false;
  return ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node);
}
