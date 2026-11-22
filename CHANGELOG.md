# Changelog

Todas as mudanças relevantes estão documentadas aqui. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento
[SemVer](https://semver.org/lang/pt-BR/).

## [0.1.1] — 2026-11-22

### Mudanças

- Requer **Node 22+** (Node 20 está fora de suporte). `engines.node` passou a
  `>=22` e a CLI mostra uma mensagem amigável ao rodar em versões anteriores.
- Matriz de CI agora cobre Node 22 e 24 em Ubuntu, Windows e macOS; o workflow
  de Release roda em Node 22.
- Imagem Docker atualizada para `node:22-slim`.

## [0.1.0] — 2026-11-22

Primeira versão pública. Reúne as Etapas 1–6 do roadmap em um único pacote npm
com dashboard embutido, Docker, CI e documentação.

### Etapa 1 — Fundação & Estrutura

- Monorepo pnpm (`packages/cli` e `packages/web`), TypeScript strict/ESM e CLI
  `vigiacode` com Commander.
- Configuração versionada em `.vigiacode/config.json`, com compatibilidade para
  projetos antigos em `.codeanchor/`.
- Banco local SQLite (better-sqlite3 + Drizzle ORM) com migrations automáticas.
- API Fastify em `localhost:4317` com health check, projeto, eventos,
  snapshots, estatísticas, arquivos, configurações e status/teste de IA.
- Esqueleto do dashboard React.

### Etapa 2 — O Vigia

- Watcher com chokidar: ignores do config + `.gitignore`, debounce em lotes,
  captura de `add`/`change`/`unlink`, limites de tamanho e camadas.
- Diffs via Git (incluindo untracked), truncagem configurável e snapshots por
  commit.
- Resumos com IA: OpenAI, Anthropic, Gemini, APIs OpenAI-compatible, Ollama e
  heurístico local, com fila assíncrona, fallback em cadeia e `ai test/use`.
- SSE em tempo real e `vigiacode log`.
- Chaves somente em variáveis de ambiente ou `.vigiacode/.env`.

### Etapa 3 — Dashboard Visual

- Linha do tempo com lotes, diffs coloridos e resumo por IA.
- Agenda de Evolução, ranking de arquivos, histórico por arquivo e
  configurações.
- Tema claro/escuro, reconexão SSE com backoff e indicadores de API/ao vivo.

### Etapa 4 — Detector de Amarrações

- Extractors genéricos para React/Vue/Svelte, Express/Fastify/Nest/Next, Spring,
  FastAPI, Drizzle, Prisma, TypeORM, JPA e migrations SQL.
- Regras **R1–R10** + GREEN, perfis `strict`/`balanced`/`lenient`, falsos
  positivos aceitos e scan incremental com cache por hash.
- Matriz entidade × front × back × banco, CLI `bindings scan/list/matrix`,
  rotas da API, SSE e explicação com IA.
- Fixtures React+Fastify+Drizzle, React+Spring+Flyway e Next+Prisma.

### Etapa 5 — O Arquiteto + Servidor MCP

- Roadmap vivo determinístico (amarrações 🔴, débitos e arquivos quentes sem
  teste), com auto-fechamento por evidência e reabertura segura.
- Dashboard do Arquiteto em kanban, filtros e plano opcional com IA.
- Servidor MCP via stdio com ferramentas, recursos e prompt `antes-de-codar`
  para Cursor, Claude Code, Qoder e Trae.
- Controle de ruído: cobertura por regra, saúde ponderada e de campo e
  agrupamento por módulo/regra.

### Etapa 6 — Lançamento

- **Saúde de contrato** como métrica principal:
  `1 − (pendências ponderadas / itens avaliados)`, com 🔴 peso 1 e 🟡 peso 0,3;
  as demais saúdes passam a ser detalhe.
- Estado **✓ ok** na matriz para contratos em 2 camadas quando a terceira não se
  aplica (ex.: endpoint usado pelo front sem tabela própria); itens ok entram na
  saúde de contrato como avaliados sem pendência.
- Débitos `TODO/FIXME/HACK` agrupados **por módulo**: um item por módulo com a
  lista `arquivo:linha` na evidência. `TODO` vira `p3`; `FIXME`/`HACK`, `p2`.
  Config `architect.todoComments` (padrão `true`) liga/desliga a coleta.
- Os “próximos 5 passos” ignoram débitos `p3`.
- Pacote npm único `vigiacode` 0.1.0 com o dashboard embutido em
  `dist/web`, migrations em `dist/drizzle` e instalação via `npx`.
- Dockerfile multi-stage (`node:20-slim`, não-root, porta 4317, `/project:ro` +
  volume `.vigiacode`) e `docker-compose.yml`.
- README em português e inglês, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
  templates de issue/PR e `docs/ci.md`.
- Workflows de CI (matriz Ubuntu/Windows/macOS × Node 20/22) e de Release por
  tag (anexa `.tgz`; publica no npm só com `NPM_TOKEN`).
- Varredura de segredos no repositório e no histórico do Git.

[0.1.1]: https://github.com/josejuniorctis-byte/vigiacode/releases/tag/v0.1.1
[0.1.0]: https://github.com/josejuniorctis-byte/vigiacode/releases/tag/v0.1.0
