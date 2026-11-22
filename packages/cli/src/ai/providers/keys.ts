import {
  ANTHROPIC_API_KEY_ENV,
  LEGACY_CODEANCHOR_API_KEY_ENV,
  VIGIACODE_API_KEY_ENV,
  GEMINI_API_KEY_ENV,
  GOOGLE_API_KEY_ENV,
  OPENAI_API_KEY_ENV,
  type LlmProvider,
} from '../../config.js';

export interface ApiKeyStatus {
  /** true quando há chave ou quando o provider não exige chave. */
  present: boolean;
  /** Nunca deve ser logado. */
  key: string | null;
  /** Variáveis aceitas, na ordem de prioridade. */
  variables: string[];
}

export function requiresApiKey(provider: LlmProvider): boolean {
  return provider !== 'none' && provider !== 'ollama';
}

/** Variáveis aceitas para cada provider, na ordem de prioridade. */
export function apiKeyCandidates(provider: LlmProvider): string[] {
  switch (provider) {
    case 'openai':
      return [OPENAI_API_KEY_ENV, VIGIACODE_API_KEY_ENV, LEGACY_CODEANCHOR_API_KEY_ENV];
    case 'anthropic':
      return [ANTHROPIC_API_KEY_ENV, VIGIACODE_API_KEY_ENV, LEGACY_CODEANCHOR_API_KEY_ENV];
    case 'gemini':
      return [
        GEMINI_API_KEY_ENV,
        GOOGLE_API_KEY_ENV,
        VIGIACODE_API_KEY_ENV,
        LEGACY_CODEANCHOR_API_KEY_ENV,
      ];
    case 'openai-compatible':
      return [VIGIACODE_API_KEY_ENV, LEGACY_CODEANCHOR_API_KEY_ENV];
    case 'none':
    case 'ollama':
    default:
      return [];
  }
}

export function resolveApiKey(
  provider: LlmProvider,
  env: NodeJS.ProcessEnv = process.env,
): ApiKeyStatus {
  const variables = apiKeyCandidates(provider);

  for (const variable of variables) {
    const value = env[variable]?.trim();
    if (value && value.length > 0) {
      return { present: true, key: value, variables };
    }
  }

  return { present: !requiresApiKey(provider), key: null, variables };
}

export function requireApiKey(provider: LlmProvider, env: NodeJS.ProcessEnv = process.env): string {
  const status = resolveApiKey(provider, env);
  if (status.key) return status.key;
  if (!status.present) throw new MissingApiKeyError(provider, status.variables);
  return '';
}

export class MissingApiKeyError extends Error {
  constructor(
    readonly provider: LlmProvider,
    readonly variables: string[],
  ) {
    super(missingKeyMessage(provider, variables));
    this.name = 'MissingApiKeyError';
  }
}

export function missingKeyMessage(provider: LlmProvider, variables: string[]): string {
  const primary = variables[0] ?? VIGIACODE_API_KEY_ENV;
  const alternatives = variables.slice(1);

  const lines = [
    `Chave de API ausente para o provider "${provider}".`,
    alternatives.length > 0
      ? `Defina ${primary} (ou ${alternatives.join(', ')} como fallback).`
      : `Defina ${primary}.`,
    `  Bash:       export ${primary}="sua-chave"`,
    `  PowerShell: $env:${primary}="sua-chave"`,
    `  .env:       ${primary}=sua-chave  (em .vigiacode/.env ou .codeanchor/.env)`,
  ];

  return lines.join('\n');
}
