# Como contribuir

Obrigado por ajudar o VigiaCode. O projeto é um monorepo pnpm com duas partes:

- `packages/cli` — CLI `vigiacode`, API Fastify, detector de amarrações,
  Arquiteto, servidor MCP e migrations SQLite;
- `packages/web` — dashboard React servido pelo build embutido no pacote.

## Ambiente

Pré-requisitos: **Node 20 ou 22** e **pnpm 10+**. O `better-sqlite3` precisa de
um binário nativo — veja os requisitos por sistema em
[RELEASE.md](RELEASE.md#2-requisitos-do-better-sqlite3).

```bash
pnpm install
pnpm build      # builda o web (packages/cli/dist/web) e depois o CLI
pnpm dev        # CLI em watch + Vite em http://localhost:5173
```

Fluxo comum:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Os testes usam Vitest. Em máquinas com pouca memória, rode por pacote e com
forks:

```bash
cd packages/cli && npx vitest run --pool=forks
cd packages/web && npx vitest run --pool=forks
```

## Regras de código

- TypeScript strict, ESM, sem `any` gratuito.
- Mensagens da CLI e do dashboard em **português**.
- Nada de rede no caminho crítico: o detector e o Arquiteto são determinísticos;
  IA é opcional e sempre tem fallback heurístico.
- Não introduza dependências novas sem justificar no PR (o alvo é um pacote
  pequeno e autocontido).
- Prettier é a fonte da verdade de formatação (`pnpm format`).

## Detector de amarrações

Se mexer em regras (`src/bindings/rules.ts`), extractors ou matriz:

1. Atualize/adicionar testes em `packages/cli/src/bindings/**`;
2. Rode o scan nos fixtures:

```bash
cd packages/cli/test/fixtures/react-fastify-drizzle
node ../../../dist/index.js bindings scan --fail-on none
```

3. Confira a matriz (`bindings matrix`) e a cobertura por regra para garantir
   que o ruído não aumentou sem explicação.

Falsos positivos aceitos vivem em `bindings.acceptedFalsePositives` no
`config.json` — use isso em vez de silenciar regras inteiras.

## Commits e PRs

- Commits em Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`…), em
  português, com o **porquê** no corpo quando não for óbvio.
- Um PR por assunto, com resumo, passos de validação e checklist do template.
- Não envie chaves, tokens, dados de clientes ou prints com segredos.
- Mudou comportamento? Atualize README/docs/CHANGELOG e os testes.

## Reportar problemas

Use os templates de issue: **bug**, **feature** ou **falso positivo de
amarração**. Para falhas de segurança, siga [SECURITY.md](SECURITY.md) em vez de
abrir uma issue pública.
