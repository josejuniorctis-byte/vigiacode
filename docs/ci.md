# VigiaCode no CI

O gate de CI usa a saúde de contrato do detector de amarrações: o scan falha
quando encontra pendências no nível configurado.

```bash
vigiacode bindings scan --fail-on red      # padrão
vigiacode bindings scan --fail-on yellow   # mais rígido
vigiacode bindings scan --fail-on none     # só relatório, nunca falha
```

Códigos de saída: `0` limpo, `1` pendências acima do limite (`red` ou `yellow`).
O scan roda sem interface, sem IA e sem servidor — só lê o repositório e grava
`.vigiacode/` (cache e histórico).

## GitHub Actions

Cole em `.github/workflows/vigiacode.yml` no repositório do seu projeto:

```yaml
name: VigiaCode

on:
  pull_request:
  push:
    branches: [main]

jobs:
  bindings:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # histórico completo ajuda os diffs e os snapshots

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Instalar o VigiaCode
        run: npm install -g vigiacode

      - name: Inicializar (sem tocar no .gitignore)
        run: vigiacode init --yes --no-gitignore

      - name: Gate de amarrações
        run: vigiacode bindings scan --fail-on red
```

Notas:

- O pacote traz o dashboard embutido; o CI não precisa de build de front-end.
- `better-sqlite3` usa binário pré-compilado no Node 20/22 em `ubuntu-latest`.
  Se o runner não tiver o prebuild, instale `build-essential` e `python3`.
- Para guardar o histórico entre execuções, faça cache de `.vigiacode/`
  (opcional; o scan é incremental por hash de arquivo).
- Para publicar o resultado como artefato, rode `vigiacode bindings list -n 500`
  e `vigiacode architect list -n 500` num passo `run: … > vigiacode-report.txt`
  seguido de `actions/upload-artifact@v4`.

## GitLab CI

```yaml
vigiacode:
  image: node:20-slim
  before_script:
    - apt-get update && apt-get install -y --no-install-recommends python3 make g++ git
    - npm install -g vigiacode
    - vigiacode init --yes --no-gitignore
  script:
    - vigiacode bindings scan --fail-on red
```

## Pré-commit (opcional)

```bash
#!/bin/sh
# .git/hooks/pre-commit
vigiacode bindings scan --fail-on red || {
  echo "Amarrações 🔴 pendentes. Rode 'vigiacode bindings list --status red'."
  exit 1
}
```

## Leitura no agente

O mesmo estado pode ser consultado pelo servidor MCP (`vigiacode mcp`) antes de
codar. Em CI, prefira a CLI: ela não abre porta e usa apenas o banco local.
