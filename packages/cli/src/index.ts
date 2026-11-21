#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { runInit } from './commands/init.js';
import { runLog } from './commands/log.js';
import { runStartCommand } from './commands/start.js';
import { isLlmProvider, type LlmProvider } from './config.js';
import { CHANGE_EVENT_LAYERS, isChangeEventLayer, type ChangeEventLayer } from './db/index.js';
import { logger } from './utils/logger.js';
import { VERSION } from './version.js';

interface InitCliOptions {
  name?: string;
  provider?: LlmProvider;
  model?: string;
  baseUrl?: string;
  debounce?: number;
  maxFileSize?: number;
  maxDiff?: number;
  aiTimeout?: number;
  yes?: boolean;
  force?: boolean;
}

interface StartCliOptions {
  port?: number;
  host?: string;
  watch?: boolean;
}

interface LogCliOptions {
  limit?: number;
  layer?: ChangeEventLayer;
}

function parseProvider(value: string): LlmProvider {
  if (!isLlmProvider(value)) {
    throw new InvalidArgumentError(
      `Provider inválido: "${value}". Use "none", "byok" ou "ollama".`,
    );
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError('A porta deve ser um número entre 1 e 65535.');
  }
  return port;
}

function parsePositiveInt(label: string, min = 1) {
  return (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < min) {
      throw new InvalidArgumentError(`${label} deve ser um inteiro maior ou igual a ${min}.`);
    }
    return parsed;
  };
}

function parseBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidArgumentError('URL inválida. Exemplo: https://api.openai.com/v1');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidArgumentError('A URL deve usar http:// ou https://.');
  }
  return value.replace(/\/+$/, '');
}

function parseLayer(value: string): ChangeEventLayer {
  if (!isChangeEventLayer(value)) {
    throw new InvalidArgumentError(
      `Camada inválida: "${value}". Use: ${CHANGE_EVENT_LAYERS.join(', ')}.`,
    );
  }
  return value;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('codeanchor')
    .description(
      'CodeAnchor — AI Dev Companion e rastreador de arquitetura para projetos desenvolvidos com agentes de IA.',
    )
    .version(VERSION, '-v, --version', 'mostra a versão da CLI')
    .helpOption('-h, --help', 'mostra a ajuda')
    .usage('<comando> [opções]')
    .showHelpAfterError('Use "codeanchor --help" para ver os comandos disponíveis.');

  program
    .command('init')
    .description('Inicializa o CodeAnchor na raiz do projeto atual')
    .option('--name <nome>', 'nome do projeto (padrão: nome da pasta)')
    .option('--provider <provider>', 'provider de IA: none | byok | ollama', parseProvider, 'none')
    .option('--model <modelo>', 'modelo de IA (ex.: gpt-4o-mini, llama3.2)')
    .option('--base-url <url>', 'endpoint da IA (OpenAI-compatível ou Ollama)', parseBaseUrl)
    .option(
      '--debounce <ms>',
      'agrupa mudanças neste intervalo (padrão: 1500)',
      parsePositiveInt('debounce', 50),
    )
    .option(
      '--max-file-size <kb>',
      'ignora arquivos maiores que isso em KB (padrão: 500)',
      parsePositiveInt('max-file-size'),
    )
    .option(
      '--max-diff <kb>',
      'trunca diffs maiores que isso em KB (padrão: 200)',
      parsePositiveInt('max-diff'),
    )
    .option(
      '--ai-timeout <ms>',
      'timeout de cada chamada de IA em ms (padrão: 15000)',
      parsePositiveInt('ai-timeout', 100),
    )
    .option('-y, --yes', 'não pergunta nada e adiciona .codeanchor/ ao .gitignore')
    .option('-f, --force', 'recria a configuração mesmo se o projeto já estiver inicializado')
    .action(async (options: InitCliOptions) => {
      await runInit({
        cwd: process.cwd(),
        name: options.name,
        provider: options.provider,
        model: options.model,
        baseUrl: options.baseUrl,
        debounceMs: options.debounce,
        maxFileSizeKb: options.maxFileSize,
        maxDiffKb: options.maxDiff,
        timeoutMs: options.aiTimeout,
        yes: options.yes,
        force: options.force,
      });
    });

  program
    .command('start')
    .description('Sobe a API local (Fastify), inicia o vigia e serve a interface web')
    .option('-p, --port <porta>', 'porta da API (padrão: 4317)', parsePort)
    .option('--host <host>', 'endereço de escuta (padrão: localhost)')
    .option('--no-watch', 'não inicia o vigia de arquivos')
    .action(async (options: StartCliOptions) => {
      await runStartCommand({
        cwd: process.cwd(),
        port: options.port,
        host: options.host,
        watch: options.watch,
      });
    });

  program
    .command('log')
    .description('Lista os últimos eventos capturados pelo vigia')
    .option(
      '-n, --limit <n>',
      'quantidade de eventos (padrão: 20, máx: 200)',
      parsePositiveInt('limit'),
    )
    .option(
      '--layer <layer>',
      'filtra por camada: frontend | backend | database | config | other',
      parseLayer,
    )
    .action(async (options: LogCliOptions) => {
      await runLog({
        cwd: process.cwd(),
        limit: options.limit,
        layer: options.layer,
      });
    });

  program.addHelpCommand('help [comando]', 'mostra a ajuda');

  program.addHelpText(
    'after',
    `
Exemplos:
  codeanchor init                      prepara .codeanchor/ e o banco local
  codeanchor init --provider ollama    configura IA local (modelo padrão: llama3.2)
  codeanchor init --yes                inicializa sem perguntas
  codeanchor start                     sobe a API e o vigia em http://localhost:4317
  codeanchor start --no-watch          sobe só a API, sem observar arquivos
  codeanchor log                       mostra os últimos eventos e resumos
  codeanchor log --layer backend -n 5  filtra os eventos de back-end
`,
  );

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
