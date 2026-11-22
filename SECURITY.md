# Segurança

## Versões suportadas

| Versão | Suporte |
| ------ | ------- |
| 0.1.x  | Sim     |

## Como reportar

Não abra issue pública para falhas de segurança. Use o recurso **Security
Advisories** do GitHub (aba _Security_ → _Report a vulnerability_) ou o contato
listado no perfil do mantenedor. Inclua:

- versão do VigiaCode (`vigiacode --version`), Node e sistema;
- passos de reprodução e impacto;
- trechos de log **sem chaves ou dados sensíveis**.

Você receberá uma confirmação de recebimento e uma previsão de correção.

## Modelo de segurança

- **Local por padrão.** O servidor escuta `localhost:4317`; o MCP usa stdio. Não
  há telemetria, conta na nuvem ou sincronização.
- **Chaves apenas no ambiente.** Tokens de IA vivem em variáveis de ambiente ou
  em `.vigiacode/.env` (coberto pelo `.gitignore`). Eles **nunca** são gravados
  no `config.json`, no SQLite, no dashboard ou nas respostas da API; o máximo
  exposto é `keyPresent: true/false`.
- **MCP com escrita mínima.** A única ferramenta de escrita,
  `vigiacode_roadmap_update`, altera somente o banco do próprio projeto. O
  servidor não executa comandos do projeto nem lê `.env` de terceiros.
- **Projeto somente leitura.** O detector e o Arquiteto escrevem apenas em
  `.vigiacode/`. No Docker, `/project` é montado `:ro` e somente
  `/project/.vigiacode` é gravável.
- **Dados locais.** O SQLite fica em `.vigiacode/vigiacode.db` (WAL). Apague a
  pasta para zerar histórico e cache.

## Boas práticas ao usar IA

- Prefira um provedor com política de retenção adequada ao seu código.
- Se o repositório tiver segredos em arquivos rastreados, o diff capturado pode
  conter esses valores — o VigiaCode não faz redação automática de diffs.
  Mantenha segredos fora do Git e use `.vigiacode/.env`.
- Revise as permissões do agente que usa MCP; o VigiaCode não amplia os poderes
  do editor.

## Dependências

`npm audit` e `pnpm audit` podem ser usados no repositório. O único módulo
nativo é `better-sqlite3`; o restante é JavaScript/TypeScript.
