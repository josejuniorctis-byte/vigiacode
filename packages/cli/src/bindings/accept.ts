/**
 * Falsos positivos aceitos: a fonte de verdade é `bindings.acceptedFalsePositives`
 * no `.vigiacode/config.json` (versionável). A coluna `accepted` do banco é
 * derivada e ressincronizada a cada scan.
 */

export interface AcceptanceTarget {
  ruleId: string;
  entity: string;
  field: string;
}

/** Formato canônico gravado no config. */
export function falsePositivePattern(target: AcceptanceTarget): string {
  return `${target.ruleId}:${target.entity}:${target.field}`;
}

/** true quando o padrão ("R1:user:phone", "R1:user:*" etc.) cobre o alvo. */
export function matchesAcceptedFalsePositive(
  patterns: readonly string[],
  target: AcceptanceTarget,
): boolean {
  for (const pattern of patterns) {
    const [rule, entity, field] = pattern.split(':');
    if (!rule || rule !== target.ruleId) continue;
    if (entity && entity !== '*' && entity !== target.entity) continue;
    if (field && field !== '*' && field !== target.field) continue;
    return true;
  }
  return false;
}

/** Acrescenta o padrão sem duplicar; devolve a lista atualizada. */
export function addAcceptedFalsePositive(
  patterns: readonly string[],
  target: AcceptanceTarget,
): { patterns: string[]; pattern: string; added: boolean } {
  const pattern = falsePositivePattern(target);
  if (patterns.includes(pattern)) {
    return { patterns: [...patterns], pattern, added: false };
  }
  return { patterns: [...patterns, pattern], pattern, added: true };
}
