# ⚓ CodeAnchor

**AI Dev Companion e rastreador de arquitetura para quem desenvolve com agentes de IA** (Cursor, Claude Code, Windsurf).

O CodeAnchor acompanha o seu projeto enquanto o código evolui: registra cada mudança com o diff, resume o que aconteceu e, nas próximas etapas, vai detectar **amarrações pendentes** entre front-end, back-end e banco.

> **Status: Etapa 2.1 — O Vigia + Multi-provedor de IA.**
> O `codeanchor start` observa o projeto, captura diffs do Git, grava eventos no SQLite, gera resumos em português e transmite tudo por SSE. A IA pode vir de OpenAI, Anthropic, Gemini, qualquer API OpenAI-compatible ou Ollama. O dashboard completo e o detector de amarrações ficam para as próximas etapas.

---

## O que já existe

- Monorepo com **pnpm workspaces** (`packages/cli` e `packages/web`).
- CLI `codeanchor` em TypeScript strict/ESM com **Commander**.
- Banco local **SQLite** (better-sqlite3) com **Drizzle ORM** e migrations via **drizzle-kit**.
- Servidor **Fastify** em `localhost:4317` com health check, projeto, eventos, SSE e status da IA.
- **Vigia de arquivos** com chokidar: ignores do config + `.gitignore`, debounce e captura de `add`/`change`/`unlink`.
- **Diffs do Git** via simple-git, incluindo arquivos novos não rastreados, com truncagem configurável e snapshots por commit.
- **Multi-provedor de IA**: `openai`, `anthropic`, `gemini`, `openai-compatible` (OpenRouter, Groq, DeepSeek, LM Studio…), `ollama` e o heurístico `none`, com fila assíncrona e fallback em cadeia.
- Comandos `codeanchor init`, `start`, `log`, `ai test` e `ai use`, com mensagens em português.
- Esqueleto web em **React + Vite + Tailwind CSS** com a página “CodeAnchor rodando”.
- ESLint + Prettier + 84 testes com **Vitest**.

**Ainda não implementado (proposital):** detector de amarrações (Etapa 3), dashboard completo (Etapa 5) e relatórios de evolução (Etapa 6).

---

## O Vigia

Quando você roda `codeanchor start`, o CodeAnchor:

1. Abre o banco local e aplica as migrations pendentes.
2. Detecta se o projeto é um repositório Git (se não for, avisa e segue registrando eventos sem diff).
3. Observa a raiz do projeto com **chokidar**, respeitando `watch.ignore`, o `.gitignore` do usuário e ignores fixos (`node_modules`, `dist`, `.git`, `.codeanchor`, cobertura etc.).
4. Ignora binários e arquivos maiores que `watch.maxFileSizeKb` (padrão 500 KB).
5. Agrupa mudanças rápidas num **lote** após `watch.debounceMs` (padrão 1500 ms) — ideal para agentes que editam vários arquivos de uma vez.
6. Para cada arquivo do lote, captura o diff em relação ao `HEAD` (`git diff HEAD`), gerando diff completo para arquivos novos/untracked e de remoção para `unlink`.
7. Trunca diffs acima de `git.maxDiffKb` (padrão 200 KB), marcando `diffTruncated`.
8. Grava uma linha em `change_events` por arquivo, com `batch_id` e `layer` (`frontend`, `backend`, `database`, `config`, `other`).
9. Publica os eventos no SSE e enfileira o resumo de IA. O evento entra **na hora com `summary: null`**; o resumo é preenchido depois, sem travar o vigia.
10. Verifica o `HEAD` a cada lote e a cada 5 s; quando um commit novo aparece, grava um snapshot em `snapshots`.
11. Registra no terminal um resumo do lote:

```text
🛰️ 3 arquivos alterados (frontend, backend, database) — resumo: 3 arquivos alterados em src, db: +7 −0. Camada: frontend, backend, database. Impacto provável: ...
```

Use `codeanchor start --no-watch` para subir apenas a API, sem observar arquivos.

### Resumos e IA

| Provider            | Variável de ambiente                          | Modelo padrão             | Exemplo de uso                                                                                 |
| ------------------- | --------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `none`              | —                                             | heurístico local          | `codeanchor ai use none`                                                                       |
| `openai`            | `OPENAI_API_KEY` (ou `CODEANCHOR_API_KEY`)    | `gpt-4o-mini`             | `codeanchor ai use openai --model gpt-4o-mini`                                                 |
| `anthropic`         | `ANTHROPIC_API_KEY` (ou `CODEANCHOR_API_KEY`) | `claude-3-5-haiku-latest` | `codeanchor ai use anthropic --model claude-3-5-haiku-latest`                                  |
| `gemini`            | `GEMINI_API_KEY` ou `GOOGLE_API_KEY`          | `gemini-2.0-flash`        | `codeanchor ai use gemini --model gemini-2.0-flash`                                            |
| `openai-compatible` | `CODEANCHOR_API_KEY`                          | definido por você         | `codeanchor ai use openai-compatible --base-url https://openrouter.ai/api/v1 --model <modelo>` |
| `ollama`            | —                                             | `llama3.2`                | `codeanchor ai use ollama --model llama3.2`                                                    |

As chaves vivem **somente** em variáveis de ambiente (ou no `.codeanchor/.env`), nunca no `config.json` ou no banco. `CODEANCHOR_API_KEY` funciona como fallback genérico para OpenAI, Anthropic e Gemini, e é a variável usada por `openai-compatible`. Se a IA falhar, expirar ou não estiver configurada, o resumo heurístico assume automaticamente.

**Exemplos:**

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."                # PowerShell: $env:OPENAI_API_KEY="sk-..."
codeanchor ai use openai --model gpt-4o-mini

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
codeanchor ai use anthropic --model claude-3-5-haiku-latest

# Gemini (GOOGLE_API_KEY também é aceita)
export GEMINI_API_KEY="..."
codeanchor ai use gemini --model gemini-2.0-flash

# OpenRouter / Groq / DeepSeek / LM Studio (API compatível com OpenAI)
export CODEANCHOR_API_KEY="sk-or-..."
codeanchor ai use openai-compatible --base-url https://openrouter.ai/api/v1 --model meta-llama/llama-3.1-8b-instruct

# Ollama local
ollama serve && ollama pull llama3.2
codeanchor ai use ollama --model llama3.2
```

**Teste e diagnóstico:**

```bash
codeanchor ai test       # envia um prompt curto e mostra tempo, modelo e resposta
```

O comando explica erros comuns: chave ausente (com exemplos Bash/PowerShell), HTTP 401/403, modelo/endpoint não encontrado (404), timeout e Ollama fora do ar.

**Arquivo `.codeanchor/.env`** (já coberto pelo `.codeanchor/` no `.gitignore`):

```bash
OPENAI_API_KEY=sk-...
CODEANCHOR_API_KEY=sk-or-...
```

O `.env` é carregado no `start` e no `ai test`, sem sobrescrever variáveis já definidas no ambiente.

**Fallback opcional** no `config.json`:

```json
"fallback_providers": ["ollama", "none"]
```

Se o provider principal falhar, os fallbacks são tentados em ordem; por último, o resumo heurístico local sempre funciona.

O prompt pede um resumo curto em português com: o que mudou, a camada afetada e o possível impacto. Quando a IA responde, o resumo final também aparece no terminal com `🤖` (o lote em si é logado na hora com o resumo heurístico).

---

## Stack

| Camada    | Escolha                                                     |
| --------- | ----------------------------------------------------------- |
| Runtime   | Node.js 20+ (ESM)                                           |
| Monorepo  | pnpm workspaces                                             |
| CLI       | TypeScript strict, Commander                                |
| API       | Fastify 5 + SSE                                             |
| Watcher   | chokidar 4                                                  |
| Git       | simple-git                                                  |
| Banco     | SQLite (better-sqlite3) + Drizzle ORM + drizzle-kit         |
| Web       | React 19 + Vite + Tailwind CSS 4                            |
| Qualidade | ESLint 9 (flat config), Prettier, Vitest, TypeScript strict |

A camada de banco fica isolada em `packages/cli/src/db/` — apenas ela conhece o dialeto. Para suportar PostgreSQL no futuro, basta adicionar um schema/repositório equivalentes e trocar o client, sem mexer em comandos ou rotas.

---

## Estrutura

```text
codeanchor/
├─ package.json            scripts: dev, build, lint, test
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ eslint.config.js
├─ packages/
│  ├─ cli/
│  │  ├─ package.json      name "codeanchor", bin "codeanchor" → dist/index.js
│  │  ├─ drizzle/          migrations SQL (0000_init + 0001_watcher)
│  │  ├─ drizzle.config.ts
│  │  └─ src/
│  │     ├─ index.ts       entry do Commander
│  │     ├─ config.ts      leitura/escrita do .codeanchor/config.json
│  │     ├─ commands/      init.ts, start.ts, log.ts, ai.ts
│  │     ├─ db/            schema.ts, client.ts, migrate.ts, repository.ts
│  │     ├─ watcher/       chokidar, debounce, ignores, layers, recorder
│  │     ├─ git/           diffs (simple-git) e snapshots por commit
│  │     ├─ ai/            summarizer, fila, status e providers/ (openai, anthropic, gemini, compatible, ollama)
│  │     ├─ server/        Fastify + rotas + SSE + estático
│  │     └─ utils/         logger e loader de .env
│  └─ web/                 Vite + React + Tailwind (esqueleto)
└─ README.md, LICENSE (MIT), .editorconfig, .gitignore
```

---

## Como rodar localmente

Pré-requisitos: **Node.js 20+** e **pnpm 10+**.

```bash
# 1. instalar dependências do monorepo
pnpm install

# 2. buildar CLI e web
pnpm build

# 3. inicializar o CodeAnchor neste repositório (para testar a fundação)
pnpm codeanchor init

# 4. subir a API, o vigia e a interface em http://localhost:4317
pnpm codeanchor start
```

### Usar em um projeto seu

O `init` roda na raiz do projeto que você quer acompanhar:

```bash
cd /caminho/do/meu-projeto
node /caminho/para/codeanchor/packages/cli/dist/index.js init
node /caminho/para/codeanchor/packages/cli/dist/index.js start
```

Para ter o comando `codeanchor` disponível em qualquer pasta, linke o pacote globalmente:

```bash
cd packages/cli
pnpm link --global      # ou: npm link
codeanchor init
codeanchor start
```

Depois de publicado no npm, os mesmos comandos ficam:

```bash
npx codeanchor init
npx codeanchor start
```

### Teste rápido

```bash
curl http://localhost:4317/api/health
# {"status":"ok","version":"0.1.0"}
curl http://localhost:4317/api/ai/status

# teste o provider de IA configurado
codeanchor ai test

# edite alguns arquivos e veja o lote no terminal; depois:
codeanchor log
curl -N http://localhost:4317/api/events/stream
```

---

## Comandos da CLI

### `codeanchor init`

Executa na raiz do projeto do usuário e:

1. cria `.codeanchor/config.json` e `.codeanchor/codeanchor.db`;
2. aplica as migrations e registra o projeto na tabela `projects`;
3. adiciona `.codeanchor/` ao `.gitignore` existente (pergunta antes, ou use `-y/--yes`);
4. avisa e **não sobrescreve** se o projeto já estiver inicializado (`-f/--force` recria a configuração preservando o banco).

```bash
codeanchor init --provider openai --model gpt-4o-mini --yes
```

| Flag                   | Descrição                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `--name <nome>`        | nome do projeto (padrão: nome da pasta)                                                      |
| `--provider <p>`       | `none` (padrão), `openai`, `anthropic`, `gemini`, `openai-compatible` ou `ollama`            |
| `--model <modelo>`     | modelo de IA (ex.: `gpt-4o-mini`, `claude-3-5-haiku-latest`, `gemini-2.0-flash`, `llama3.2`) |
| `--base-url <url>`     | endpoint do provider (obrigatório para `openai-compatible`)                                  |
| `--debounce <ms>`      | agrupamento de mudanças (padrão: 1500)                                                       |
| `--max-file-size <kb>` | arquivos maiores que isso são ignorados (padrão: 500)                                        |
| `--max-diff <kb>`      | diffs maiores que isso são truncados (padrão: 200)                                           |
| `--ai-timeout <ms>`    | timeout por chamada de IA (padrão: 15000)                                                    |
| `-y, --yes`            | não pergunta nada e atualiza o `.gitignore`                                                  |
| `-f, --force`          | recria a configuração mesmo se já inicializado                                               |

Sem `--yes`, o `init` pergunta interativamente o provider e o modelo (e a base URL para `openai-compatible`).

### `codeanchor start`

Exige `init` prévio. Sobe o Fastify em `localhost:4317`, inicia o vigia e serve o build de `packages/web/dist` na raiz quando ele existe.

```bash
codeanchor start                  # API + vigia
codeanchor start --port 4400      # outra porta
codeanchor start --no-watch       # só a API, sem observar arquivos
```

### `codeanchor log`

Lista os últimos eventos capturados, com camada, tipo, contagem de linhas e resumo.

```bash
codeanchor log
codeanchor log --limit 10
codeanchor log --layer backend
```

### `codeanchor ai test`

Envia um prompt curto ao provider configurado e mostra tempo de resposta, modelo e amostra do texto — ou o erro explicado.

```bash
codeanchor ai test
```

### `codeanchor ai use <provider>`

Troca o provider (e opcionalmente modelo/endpoint) sem refazer o `init`.

```bash
codeanchor ai use openai --model gpt-4o-mini
codeanchor ai use anthropic --model claude-3-5-haiku-latest
codeanchor ai use gemini --model gemini-2.0-flash
codeanchor ai use openai-compatible --base-url https://openrouter.ai/api/v1 --model <modelo>
codeanchor ai use ollama --model llama3.2
codeanchor ai use none
```

---

## API local

| Rota                     | Resposta                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET /api/health`        | `{ "status": "ok", "version": "0.1.0" }`                                                                  |
| `GET /api/project`       | dados do projeto registrado                                                                               |
| `GET /api/events`        | `{ "events": [...] }` — mais recentes primeiro; aceita `?limit` (1–200), `?before` (id ou ISO) e `?layer` |
| `GET /api/events/:id`    | evento completo, incluindo `diff` e `diffTruncated`                                                       |
| `GET /api/events/stream` | SSE com `event: change` (evento novo) e `event: summary` (resumo concluído)                               |
| `GET /api/ai/status`     | provider, modelo, `keyPresent` (sem a chave) e último healthCheck                                         |
| `GET /`                  | interface web (build) ou página de fallback                                                               |

A listagem não inclui o diff completo (use `/api/events/:id`). Exemplo de paginação por cursor:

```bash
curl "http://localhost:4317/api/events?limit=20&layer=backend"
curl "http://localhost:4317/api/events?before=<id-do-ultimo-evento>"
```

SSE no terminal:

```bash
curl -N http://localhost:4317/api/events/stream
# retry: 3000
# : conectado ao CodeAnchor
# event: change
# data: {"type":"change","event":{...}}
```

---

## Banco de dados

Timestamps em **ISO 8601 (UTC)**, gravados como `TEXT`. Todas as tabelas filhas têm índice em `project_id`.

| Tabela          | Colunas                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `projects`      | `id`, `name`, `root_path`, `created_at`                                                                                                    |
| `snapshots`     | `id`, `project_id`, `commit_hash`, `created_at`                                                                                            |
| `change_events` | `id`, `project_id`, `file_path`, `change_type` (add/change/unlink), `diff`, `summary`, `batch_id`, `layer`, `diff_truncated`, `created_at` |
| `bindings`      | `id`, `project_id`, `layer` (frontend/backend/database), `entity`, `field`, `status` (red/yellow/green), `detected_at`                     |

A migration **`0001_watcher.sql`** adiciona `batch_id`, `layer` e `diff_truncated` em `change_events` (além dos índices por `layer` e `batch_id`) sem alterar a `0000_init.sql`.

Migrations são geradas com:

```bash
pnpm --filter codeanchor db:generate
```

O `init` e o `start` aplicam as migrations pendentes automaticamente (idempotente).

Exemplo de `.codeanchor/config.json`:

```json
{
  "version": 1,
  "project": { "name": "meu-app", "rootPath": "/caminho/meu-app" },
  "watch": {
    "paths": ["."],
    "ignore": ["node_modules", "dist", "build", "coverage", ".git", ".codeanchor", "*.lock"],
    "debounceMs": 1500,
    "maxFileSizeKb": 500
  },
  "git": { "maxDiffKb": 200 },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "base_url": "https://api.openai.com/v1",
    "timeout": 15000,
    "max_tokens": 512,
    "temperature": 0.2,
    "fallback_providers": ["ollama"]
  },
  "server": { "host": "localhost", "port": 4317 },
  "database": { "dialect": "sqlite", "file": "codeanchor.db" }
}
```

Configs criados nas Etapas 1 e 2 continuam funcionando: campos novos recebem os padrões e o provider legado `"byok"` é migrado automaticamente na leitura para `openai` (base OpenAI) ou `openai-compatible` (outro `base_url`).

---

## Scripts

| Comando             | O que faz                                         |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | CLI em watch + Vite dev server (proxy para a API) |
| `pnpm build`        | build do CLI (tsc) e do web (vite)                |
| `pnpm test`         | testes do CLI com Vitest (84 testes)              |
| `pnpm lint`         | ESLint em todo o monorepo                         |
| `pnpm typecheck`    | TypeScript strict sem emitir                      |
| `pnpm format`       | Prettier em todo o repositório                    |
| `pnpm codeanchor …` | executa a CLI buildada                            |

---

## Roadmap — 6 etapas

| Etapa | Nome                     | Entrega                                                                                       |
| ----- | ------------------------ | --------------------------------------------------------------------------------------------- |
| **1** | **Fundação & Estrutura** | **Monorepo, CLI, config, banco SQLite/Drizzle, API Fastify, esqueleto web**                   |
| **2** | **O Vigia**              | **Watcher + diff Git + resumos IA + SSE + `codeanchor log`**                                  |
| 2.1   | Multi-provedor de IA     | OpenAI, Anthropic, Gemini, APIs OpenAI-compatible, Ollama, fallback em cadeia e `ai test/use` |
| 3     | Detecção de amarrações   | heurísticas ligam front-end, back-end e banco por entidade/campo                              |
| 4     | Motor de IA avançado     | sugestões contextuais, sumarização por lote e memória do projeto                              |
| 5     | Dashboard                | timeline de eventos e mapa visual das amarrações                                              |
| 6     | Snapshots & Relatórios   | evolução da arquitetura ao longo do tempo, pronta para CI                                     |

---

## Licença

[MIT](LICENSE) © 2026 CodeAnchor contributors
