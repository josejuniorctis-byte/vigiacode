# VigiaCode

Rastreador de amarrações front-end × back-end × banco, roadmap vivo e servidor
MCP para projetos desenvolvidos com agentes de IA. O dashboard vai embutido no
pacote: `npx vigiacode start` abre tudo em `http://localhost:4317`.

## Início rápido (3 comandos)

```bash
npx vigiacode init --yes
npx vigiacode bindings scan
npx vigiacode start
```

- `init` cria `.vigiacode/` (config, banco SQLite e `.env` opcional).
- `bindings scan` detecta as regras R1–R10 e grava a **saúde de contrato**.
- `start` sobe a API, o dashboard, o vigia de arquivos e o Arquiteto.

## Servidor MCP

```bash
npx vigiacode mcp
```

Configuração no Cursor/Qoder/Claude Code:

```json
{
  "mcpServers": {
    "vigiacode": { "command": "npx", "args": ["-y", "vigiacode", "mcp"] }
  }
}
```

Ferramentas: `vigiacode_status` (saúde de contrato), `vigiacode_bindings`,
`vigiacode_check_entity`, `vigiacode_roadmap`, `vigiacode_roadmap_update`,
`vigiacode_recent_changes` e `vigiacode_scan`.

## CI

```bash
npx vigiacode bindings scan --fail-on red
```

## Requisitos

- Node.js 20 ou 22.
- `better-sqlite3` compila um binário nativo. Windows: Visual Studio Build
  Tools + Python 3. macOS: `xcode-select --install`. Linux: `build-essential`
  e `python3`. Se o binário pré-compilado falhar, rode `npm rebuild better-sqlite3`.

Documentação completa, regras, provedores de IA e roadmap:
<https://github.com/josejuniorctis-byte/vigiacode>.

Licença MIT © José Júnior.
