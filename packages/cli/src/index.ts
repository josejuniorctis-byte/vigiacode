#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { runAiTest, runAiUse } from './commands/ai.js';
import {
  runBindingsList,
  runBindingsMatrix,
  runBindingsScan,
  type FailOn,
} from './commands/bindings.js';
import { runInit } from './commands/init.js';
import {
  canPrompt,
  promptBaseUrlForProvider,
  promptModelForProvider,
  promptProviderChoice,
} from './commands/init-prompts.js';
import { runLog } from './commands/log.js';
import { runStartCommand } from './commands/start.js';
import {
  isBindingRuleId,
  isLlmProvider,
  LLM_PROVIDERS,
  providerDefaults,
  type LlmProvider,
} from './config.js';
import {
  CHANGE_EVENT_LAYERS,
  isChangeEventLayer,
  type BindingLayer,
  type BindingStatus,
  type ChangeEventLayer,
} from './db/index.js';
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

interface AiUseCliOptions {
  model?: string;
  baseUrl?: string;
}

interface BindingsScanCliOptions {
  failOn?: FailOn;
}

interface BindingsListCliOptions {
  status?: BindingStatus;
  layer?: BindingLayer;
  rule?: string;
  entity?: string;
  q?: string;
  resolved?: boolean;
  limit?: number;
}

function parseProvider(value: string): LlmProvider {
  if (!isLlmProvider(value)) {
    throw new InvalidArgumentError(
      `Provider inválido: "${value}". Use: ${LLM_PROVIDERS.join(', ')}.`,
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

function parseBindingStatus(value: string): BindingStatus {
  if (value !== 'red' && value !== 'yellow' && value !== 'green') {
    throw new InvalidArgumentError('Status inválido. Use: red, yellow ou green.');
  }
  return value;
}

function parseBindingLayer(value: string): BindingLayer {
  if (value !== 'frontend' && value !== 'backend' && value !== 'database') {
    throw new InvalidArgumentError('Camada inválida. Use: frontend, backend ou database.');
  }
  return value;
}

function parseBindingRule(value: string): string {
  if (value !== 'GREEN' && !isBindingRuleId(value)) {
    throw new InvalidArgumentError('Regra inválida. Use R1..R10 ou GREEN.');
  }
  return value;
}

function parseFailOn(value: string): FailOn {
  if (value !== 'red' && value !== 'yellow' && value !== 'none') {
    throw new InvalidArgumentError('--fail-on aceita: red, yellow ou none.');
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
    .option(
      '--provider <provider>',
      `provider de IA: ${LLM_PROVIDERS.join(' | ')} (padrão: none)`,
      parseProvider,
    )
    .option('--model <modelo>', 'modelo de IA (ex.: gpt-4o-mini, claude-3-5-haiku-latest)')
    .option(
      '--base-url <url>',
      'endpoint do provider (OpenAI-compatível, Ollama etc.)',
      parseBaseUrl,
    )
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
      let provider = options.provider;
      let model = options.model;
      let baseUrl = options.baseUrl;

      if (!options.yes && canPrompt()) {
        if (!provider) {
          const choice = await promptProviderChoice();
          if (choice) {
            provider = choice.provider;
            model = choice.model ?? model;
            baseUrl = choice.baseUrl ?? baseUrl;
          }
        } else if (provider !== 'none') {
          if (!model) {
            model = (await promptModelForProvider(providerDefaults(provider).model)) ?? undefined;
          }
          if (provider === 'openai-compatible' && !baseUrl) {
            baseUrl = await promptBaseUrlForProvider();
          }
        }
      }

      provider ??= 'none';

      if (provider === 'openai-compatible' && !baseUrl) {
        logger.error('O provider "openai-compatible" exige --base-url.');
        logger.hint(
          'codeanchor init --provider openai-compatible --base-url https://openrouter.ai/api/v1 --model <modelo>',
        );
        process.exitCode = 1;
        return;
      }

      await runInit({
        cwd: process.cwd(),
        name: options.name,
        provider,
        model,
        baseUrl,
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

  const bindings = program
    .command('bindings')
    .description('Detecta e lista amarrações pendentes entre front-end, back-end e banco');

  bindings
    .command('scan')
    .description('Analisa o projeto e atualiza as amarrações (exit code 1 quando há 🔴)')
    .option(
      '--fail-on <nivel>',
      'falha o comando com red (padrão), yellow ou none',
      parseFailOn,
      'red',
    )
    .action(async (options: BindingsScanCliOptions) => {
      await runBindingsScan({ cwd: process.cwd(), failOn: options.failOn });
    });

  bindings
    .command('list')
    .description('Lista as amarrações detectadas')
    .option('--status <status>', 'filtra por red, yellow ou green', parseBindingStatus)
    .option('--layer <camada>', 'filtra por frontend, backend ou database', parseBindingLayer)
    .option('--rule <regra>', 'filtra por R1..R10 ou GREEN', parseBindingRule)
    .option('--entity <entidade>', 'filtra pela entidade normalizada')
    .option('-q, --q <texto>', 'busca em entidade, campo e mensagem')
    .option('--resolved', 'inclui amarrações já resolvidas')
    .option('-n, --limit <n>', 'quantidade (padrão: 50)', parsePositiveInt('limit'))
    .action(async (options: BindingsListCliOptions) => {
      await runBindingsList({
        cwd: process.cwd(),
        status: options.status,
        layer: options.layer,
        rule: options.rule,
        entity: options.entity,
        search: options.q,
        resolved: options.resolved,
        limit: options.limit,
      });
    });

  bindings
    .command('matrix')
    .description('Mostra a matriz entidade × front-end × back-end × banco')
    .action(async () => {
      await runBindingsMatrix({ cwd: process.cwd() });
    });

  const ai = program.command('ai').description('Configura e testa o provider de IA');

  ai.command('test')
    .description('Envia um prompt curto ao provider configurado')
    .action(async () => {
      await runAiTest({ cwd: process.cwd() });
    });

  ai.command('use <provider>')
    .description('Troca o provider de IA sem refazer o init')
    .option('--model <modelo>', 'modelo a usar')
    .option('--base-url <url>', 'endpoint do provider', parseBaseUrl)
    .action(async (providerValue: string, options: AiUseCliOptions) => {
      await runAiUse({
        cwd: process.cwd(),
        provider: parseProvider(providerValue),
        model: options.model,
        baseUrl: options.baseUrl,
      });
    });

  program.addHelpCommand('help [comando]', 'mostra a ajuda');

  program.addHelpText(
    'after',
    `
Exemplos:
  codeanchor init                      prepara .codeanchor/ e o banco local
  codeanchor init --provider ollama    configura IA local (modelo padrão: llama3.2)
  codeanchor init --provider openai    usa OpenAI (chave em OPENAI_API_KEY)
  codeanchor ai test                   testa o provider configurado
  codeanchor ai use anthropic --model claude-3-5-haiku-latest
  codeanchor start                     sobe a API e o vigia em http://localhost:4317
  codeanchor start --no-watch          sobe só a API, sem observar arquivos
  codeanchor log                       mostra os últimos eventos e resumos
  codeanchor log --layer backend -n 5  filtra os eventos de back-end
  codeanchor bindings scan             detecta amarrações e falha em CI se houver 🔴
  codeanchor bindings scan --fail-on yellow
  codeanchor bindings list --status red --layer frontend
  codeanchor bindings matrix           matriz entidade × front × back × banco
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
