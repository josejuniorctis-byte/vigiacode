## Resumo

<!-- O que muda e por quê (1–3 frases). -->

## Tipo

- [ ] fix
- [ ] feat
- [ ] docs
- [ ] refactor
- [ ] test
- [ ] chore / CI

## Como validar

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

<!-- Se mexeu no detector, rode também sobre um fixture:
     node packages/cli/dist/index.js bindings scan --fail-on none
     dentro de packages/cli/test/fixtures/react-fastify-drizzle -->

## Checklist

- [ ] Testes adicionados/atualizados quando há mudança de comportamento
- [ ] Sem chaves, tokens ou dados reais em código, fixtures, docs ou prints
- [ ] Documentação atualizada (README/docs/CHANGELOG) quando aplicável
- [ ] `pnpm format:check` limpo
