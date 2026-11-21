# ⚓ CodeAnchor

**AI Dev Companion e rastreador de arquitetura para quem desenvolve com agentes de IA** (Cursor, Claude Code, Windsurf).

O CodeAnchor acompanha o seu projeto enquanto o código evolui: registra cada mudança com o diff, resume o que aconteceu e, nas próximas etapas, vai detectar **amarrações pendentes** entre front-end, back-end e banco.

> **Status: Etapa 2 — O Vigia (MVP 1).**
> O `codeanchor start` agora observa o projeto, captura diffs do Git, grava eventos no SQLite, gera resumos em português e transmite tudo por SSE. O dashboard completo e o detector de amarrações ficam para as próximas etapas.

---

## O que já existe

- Monorepo com **pnpm workspaces** (`packages/cli` e `packages/web`).
- CLI `codeanchor` em TypeScript strict/ESM com **Commander**.
- Banco local **SQLite** (better-sqlite3) com **Drizzle ORM** e migrations via **drizzle-kit**.
- Servidor **Fastify** em `localhost:4317` com health check, projeto, eventos e SSE.
- **Vigia de arquivos** com chokidar: ignores do config + `.gitignore`, debounce e captura de `add`/`change`/`unlink`.
- **Diffs do Git** via simple-git, incluindo arquivos novos não rastreados, com truncagem configurável e snapshots por commit.
- **Resumos em português** com três providers: heurístico local (`none`), OpenAI-compatível (`byok`) e Ollama (`ollama`), com fila assíncrona e fallback.
- Comandos `codeanchor init`, `start` e `log`, com mensagens em português.
- Esqueleto web em **React + Vite + Tailwind CSS** com a página “CodeAnchor rodando”.
- ESLint + Prettier + 49 testes com **Vitest**.

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

| Provider | Como funciona                              | Configuração                                                    |
| -------- | ------------------------------------------ | --------------------------------------------------------------- |
| `none`   | Resumo heurístico local, sem rede (padrão) | —                                                               |
| `byok`   | API compatível com OpenAI                  | `CODEANCHOR_API_KEY` + `model` + `base_url`                     |
| `ollama` | Modelo local via Ollama                    | `model` (padrão `llama3.2`) e endpoint `http://localhost:11434` |

A chave da IA é lida **somente** da variável de ambiente `CODEANCHOR_API_KEY`; ela nunca é gravada no `config.json` nem no banco. Se a IA falhar, expirar ou não estiver configurada, o resumo heurístico assume automaticamente.

**BYOK (OpenAI ou compatível):**

```bash
export CODEANCHOR_API_KEY="sk-..."          # PowerShell: $env:CODEANCHOR_API_KEY="sk-..."
codeanchor init --provider byok --model gpt-4o-mini --base-url https://api.openai.com/v1
codeanchor start
```

**Ollama:**

```bash
ollama serve
ollama pull llama3.2
codeanchor init --provider ollama --model llama3.2
codeanchor start
```

O prompt pede um resumo curto em português com: o que mudou, a camada afetada e o possível impacto.

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
│  │     ├─ commands/      init.ts, start.ts, log.ts
│  │     ├─ db/            schema.ts, client.ts, migrate.ts, repository.ts
│  │     ├─ watcher/       chokidar, debounce, ignores, layers, recorder
│  │     ├─ git/           diffs (simple-git) e snapshots por commit
│  │     ├─ ai/            summarizer none/byok/ollama, prompt e fila
│  │     ├─ server/        Fastify + rotas + SSE + estático
│  │     └─ utils/         logger em português
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
codeanchor init --provider byok --model gpt-4o-mini --base-url https://api.openai.com/v1 --yes
```

| Flag                   | Descrição                                             |
| ---------------------- | ----------------------------------------------------- |
| `--name <nome>`        | nome do projeto (padrão: nome da pasta)               |
| `--provider <p>`       | provider de IA: `none` (padrão), `byok` ou `ollama`   |
| `--model <modelo>`     | modelo de IA (ex.: `gpt-4o-mini`, `llama3.2`)         |
| `--base-url <url>`     | endpoint OpenAI-compatível ou do Ollama               |
| `--debounce <ms>`      | agrupamento de mudanças (padrão: 1500)                |
| `--max-file-size <kb>` | arquivos maiores que isso são ignorados (padrão: 500) |
| `--max-diff <kb>`      | diffs maiores que isso são truncados (padrão: 200)    |
| `--ai-timeout <ms>`    | timeout por chamada de IA (padrão: 15000)             |
| `-y, --yes`            | não pergunta nada e atualiza o `.gitignore`           |
| `-f, --force`          | recria a configuração mesmo se já inicializado        |

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

---

## API local

| Rota                     | Resposta                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET /api/health`        | `{ "status": "ok", "version": "0.1.0" }`                                                                  |
| `GET /api/project`       | dados do projeto registrado                                                                               |
| `GET /api/events`        | `{ "events": [...] }` — mais recentes primeiro; aceita `?limit` (1–200), `?before` (id ou ISO) e `?layer` |
| `GET /api/events/:id`    | evento completo, incluindo `diff` e `diffTruncated`                                                       |
| `GET /api/events/stream` | SSE com `event: change` (evento novo) e `event: summary` (resumo concluído)                               |
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
    "provider": "none",
    "model": null,
    "baseUrl": null,
    "timeoutMs": 15000
  },
  "server": { "host": "localhost", "port": 4317 },
  "database": { "dialect": "sqlite", "file": "codeanchor.db" }
}
```

Configs criados na Etapa 1 continuam funcionando: campos novos recebem os padrões automaticamente.

---

## Scripts

| Comando             | O que faz                                         |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | CLI em watch + Vite dev server (proxy para a API) |
| `pnpm build`        | build do CLI (tsc) e do web (vite)                |
| `pnpm test`         | testes do CLI com Vitest (49 testes)              |
| `pnpm lint`         | ESLint em todo o monorepo                         |
| `pnpm typecheck`    | TypeScript strict sem emitir                      |
| `pnpm format`       | Prettier em todo o repositório                    |
| `pnpm codeanchor …` | executa a CLI buildada                            |

---

## Roadmap — 6 etapas

| Etapa | Nome                     | Entrega                                                                     |
| ----- | ------------------------ | --------------------------------------------------------------------------- |
| **1** | **Fundação & Estrutura** | **Monorepo, CLI, config, banco SQLite/Drizzle, API Fastify, esqueleto web** |
| **2** | **O Vigia**              | **Watcher + diff Git + resumos IA + SSE + `codeanchor log`**                |
| 3     | Detecção de amarrações   | heurísticas ligam front-end, back-end e banco por entidade/campo            |
| 4     | Motor de IA avançado     | sugestões contextuais, sumarização por lote e memória do projeto            |
| 5     | Dashboard                | timeline de eventos e mapa visual das amarrações                            |
| 6     | Snapshots & Relatórios   | evolução da arquitetura ao longo do tempo, pronta para CI                   |

---

## Licença

[MIT](LICENSE) © 2026 CodeAnchor contributors
