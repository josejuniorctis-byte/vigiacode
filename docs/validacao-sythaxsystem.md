# Validação real — SythaxSystem

Data: 2026-11-21/22 (America/Sao_Paulo)
Repositório: `C:\Users\HP\Desktop\Sistema\erp-sythaxsystem`
Modo: somente leitura — apenas a pasta `.vigiacode/` foi criada (o `.gitignore` não foi alterado, graças a `--no-gitignore`). Nenhum banco ou API do SythaxSystem foi iniciado.

## Comandos

```bash
cd C:\Users\HP\Desktop\Sistema\erp-sythaxsystem
vigiacode init --yes --no-gitignore
vigiacode bindings scan --fail-on none
```

Config usada no projeto (`.vigiacode/config.json`), sem nada específico no código padrão:

```json
{
  "bindings": {
    "r1IncludeTypes": false,
    "ignore": ["docs/**", "**/db/legado-flyway/**"]
  }
}
```

- `docs/**`: o repositório guarda DDL de referência em `docs/`, que duplicava migrations.
- `**/db/legado-flyway/**`: essa pasta **não** está nos `spring.flyway.locations` (é legado fora do Flyway ativo).
- `r1IncludeTypes: false`: o front tem muitos view models/projeções; R1 passa a considerar apenas formulário/payload.

## Resultado

| Métrica                         | Valor                                               |
| ------------------------------- | --------------------------------------------------- |
| Candidatos percorridos          | 2.845 arquivos suportados                           |
| Arquivos analisados             | 2.589 (após ignores de teste/gerado/legado)         |
| Tempo do primeiro scan completo | **88,3 s** (cache frio)                             |
| Tempo dos scans seguintes       | **15–22 s** (cache por hash + extractor versionado) |
| 🔴 vermelhas                    | **3**                                               |
| 🟡 amarelas                     | **1.005**                                           |
| 🟢 verdes                       | **0**                                               |
| ✓ ok (2 de 3 camadas)           | **2**                                               |
| Itens avaliados                 | **5.656** (cobertura por regra, inclui os 2 ok)     |
| Pendências ponderadas           | **304,5** (3×1 + 1.005×0,3)                         |
| **Saúde de contrato**           | **94,6%** (exibida como 95%)                        |
| Saúde ponderada (detalhe)       | 0%                                                  |

> A saúde de contrato é a métrica principal desde a Etapa 6:
> `1 − pendências ponderadas / itens avaliados`. Os 1.005 amarelos só pesam 0,3
> cada; por isso 95%, e não 0%. A saúde ponderada antiga (0%) continua visível
> como detalhe — ela mede só os verdes contra as pendências e penaliza um
> projeto sem triplas de campo detectáveis.

Evolução: o primeiro passe, com os padrões genéricos e sem tuning de projeto, produziu **4.714 pendências (982🔴 / 3.732🟡)**. Depois dos ajustes de extractors, regras e config, caiu para **1.008 (3🔴 / 1.005🟡)** — redução de ~79%.

Por regra (avaliados × resultado no último scan):

| Regra     | Avaliados |  🔴 |  🟡 |
| --------- | --------: | --: | --: |
| R2        |        99 |   3 |   0 |
| R3        |     4.485 |   0 |  83 |
| R4        |        62 |   0 |   0 |
| R5        |       938 |   0 | 875 |
| R6        |        67 |   0 |  47 |
| R7        |         3 |   0 |   0 |
| GREEN     |         0 |   0 |   0 |
| OK        |         2 |   0 |   0 |
| R1/R8–R10 |         0 |   0 |   0 |

### Etapa 6 — saúde de contrato e débitos agrupados

| Antes (Etapa 5)                                   | Depois (Etapa 6)                                              |
| ------------------------------------------------- | ------------------------------------------------------------- |
| 153 itens abertos: 2 `p1` binding + 151 `p2` debt | 20 itens abertos: 2 `p1` binding + 18 `p3` debt por módulo    |
| um item de dívida por comentário TODO             | um item por módulo, com a lista `arquivo:linha` na evidência  |
| TODO virava `p2` e aparecia nos próximos passos   | TODO vira `p3` (FIXME/HACK `p2`) e fica fora dos 5 próximos   |
| matriz sem estado para contrato de 2 camadas      | 2 entidades marcadas **✓ ok** e contadas na saúde de contrato |

O `architect generate` fechou os 151 itens antigos com a evidência
“comentário TODO/FIXME/HACK não existe mais no projeto” (o agrupamento substitui
o item por comentário) e criou 18 itens `p3`, um por módulo. Nenhum item manual
foi tocado. O teste rodou em modo somente leitura fora de `.vigiacode/`.

### Por que 0 verdes?

O front do SythaxSystem é majoritariamente JavaScript vanilla (`sythaxsystem/**/*.js`) com clientes HTTP que montam URLs dinamicamente, enquanto o back-end expõe DTOs de request/response e o banco usa entidades JPA com nomes de colunas diferentes. O detector só marca 🟢 quando encontra o **mesmo campo** com referência de front, DTO e coluna; nesse projeto quase não há triplas de campo detectáveis (as respostas são projeções). O resultado é conservador: 0🟢 e saúde 0% é honesto, não um erro de contagem.

## As 10 pendências mais relevantes

Todas com referência `arquivo:linha` clicável no dashboard.

|   # | Regra | Entidade.campo                                 | Referências                                                                                                                                               |
| --: | ----- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | R2 🔴 | `estoque_contagem_linha.codigo_produto`        | back `src/main/java/com/automako/erp/replenishment/api/dto/EstoqueContagemLinhaRequest.java:8` · db `.../domain/model/EstoqueContagemLinhaEntity.java:24` |
|   2 | R2 🔴 | `estoque_contagem_linha.quantidade_contada`    | back `...EstoqueContagemLinhaRequest.java:8` · db `...EstoqueContagemLinhaEntity.java:24`                                                                 |
|   3 | R2 🔴 | `fin_conta_gerencial.plano_conta_codigo`       | back `src/main/java/com/automako/erp/accounting/api/dto/FinContaGerencialDTO.java:9` · db `.../domain/model/FinContaGerencial.java:21`                    |
|   4 | R3 🟡 | `cliente.razao_social`                         | migration `src/main/resources/db/migration/v01/V20260101_04__baseline_sythaxsystem_p04_cad.sql:542`                                                       |
|   5 | R3 🟡 | `cliente.consumidor_final`                     | mesma migration, linha 542                                                                                                                                |
|   6 | R3 🟡 | `cliente.contribuinte`                         | mesma migration, linha 542                                                                                                                                |
|   7 | R3 🟡 | `cliente.rede`                                 | mesma migration, linha 542                                                                                                                                |
|   8 | R3 🟡 | `atacarejo_pdv_cancelamento_otp.*`             | `src/main/java/com/automako/erp/atacarejo/domain/model/PdvCancelamentoOtp.java:23`                                                                        |
|   9 | R5 🟡 | `aprovacoe.GET /api/v1/aprovacoes`             | `src/main/java/com/automako/erp/aprovacao/api/controller/CentralAprovacoesController.java:38`                                                             |
|  10 | R5 🟡 | `aprovacoe.GET /api/v1/aprovacoes/aprovadores` | `.../CentralAprovacoesController.java:50`                                                                                                                 |

As três 🔴 são divergências reais de contrato: o DTO usa `codigoProduto`/`quantidadeContada`/`planoContaCodigo`, mas a entidade JPA persiste `codigo`+`produto_id`, `saldo_contado` e `plano_conta_id`+`codigo_conta`. As R3 de `cliente` também são reais: a entidade `ClienteEntity` usa `nome_razao_social` e não tem `consumidor_final`, `contribuinte` ou `rede_id`, embora a baseline tenha essas colunas.

## Amostra de falsos positivos (20 pendências)

Amostra estratificada: 3 🔴 + 7 R3 + 5 R5 + 5 R6. Cada item foi conferido contra os arquivos reais.

|   # | Pendência                                         | Veredito                                                                              |
| --: | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
|   1 | R2 `estoque_contagem_linha.codigo_produto`        | ✅ correto                                                                            |
|   2 | R2 `estoque_contagem_linha.quantidade_contada`    | ✅ correto                                                                            |
|   3 | R2 `fin_conta_gerencial.plano_conta_codigo`       | ✅ correto (campo derivado não persistido)                                            |
|   4 | R3 `atacarejo_pdv_cancelamento_otp.*`             | ✅ correto                                                                            |
|   5 | R3 `atacarejo_solicitacoes_cancelamento.*`        | ✅ correto                                                                            |
|   6 | R3 `audit_log.*`                                  | ✅ correto                                                                            |
|   7 | R3 `cliente.consumidor_final`                     | ✅ correto                                                                            |
|   8 | R3 `cliente.contribuinte`                         | ✅ correto                                                                            |
|   9 | R3 `cliente.razao_social`                         | ✅ correto                                                                            |
|  10 | R3 `cliente.rede`                                 | ✅ correto                                                                            |
|  11 | R5 `ajuda.POST /api/v1/public/ajuda/perguntar`    | ❌ falso positivo (a URL é montada via `base + "/api/..."` e o chamador usa variável) |
|  12 | R5 `aprovacoe.GET /api/v1/aprovacoes`             | ✅ correto                                                                            |
|  13 | R5 `aprovacoe.GET /api/v1/aprovacoes/:param`      | ✅ correto                                                                            |
|  14 | R5 `aprovacoe.GET /api/v1/aprovacoes/aprovadores` | ✅ correto                                                                            |
|  15 | R5 `aprovacoe.GET /api/v1/aprovacoes/avisos`      | ✅ correto                                                                            |
|  16 | R6 `ajuda.*`                                      | ❌ falso positivo (existe `sythaxsystem/help/`)                                       |
|  17 | R6 `aprovacoe.*`                                  | ✅ correto (não há tela de aprovações no front)                                       |
|  18 | R6 `assistencia.*`                                | ❌ falso positivo (existe `sythaxsystem/os/`)                                         |
|  19 | R6 `at.*`                                         | ⚠️ inconclusivo (referências no shell, sem tela dedicada)                             |
|  20 | R6 `audit.*`                                      | ⚠️ inconclusivo (telas de auditoria administrativas)                                  |

**Estimativa honesta:** 15 de 20 corretos (~75%); 3 falsos positivos (15%) e 2 inconclusivos. A maior fonte restante de FP é R5/R6 em um front vanilla que monta URLs em funções auxiliares e em endpoints internos/admin — não é um problema de campo/entidade. As regras de campo (R1/R2/R3) tiveram precisão alta nesta amostra.

## Ajustes feitos depois da amostra

- `frontend`: ignora `<input type="radio|checkbox|button|submit">` como campo de formulário e reconhece URLs montadas com `base + "/api/..."`.
- `R1`: só acusa quando há DTO/rota com campos no back-end; formulário/payload sempre contam. `r1IncludeTypes` permite desligar tipos de UI.
- `R2`: ignora colunas herdadas (`id`, `tenant_id`, auditoria), DTOs de resposta/projeção e campos derivados/coleções; UUID × string passou a ser compatível.
- `R3`: compara apenas entidades mapeadas por ORM; parser SQL entende `ADD COLUMN IF NOT EXISTS` em listas; JPA ignora constantes `static`, `@Transient` e coleções.
- Cache: `binding_file_cache` ganhou versão de extractor para invalidar extrações antigas após upgrade.
- Defaults: testes, `target`, `dist`, `__mocks__`, `*.test.*`/`*.spec.*` e bundles com hash são ignorados.

## Etapa 5 — revalidação (2026-11-22)

Mesmo repositório e mesmo modo somente leitura da Etapa 4: apenas `.vigiacode/` foi tocada, com `--no-gitignore`; nenhum banco ou API do SythaxSystem foi iniciado. O banco local da Etapa 4 foi migrado em cima (migrations `0003_fixes.sql` e `0004_architect.sql`), sem apagar dados.

### Antes e depois

| Métrica                           | Etapa 4       | Etapa 5 (balanced)              |
| --------------------------------- | ------------- | ------------------------------- |
| Arquivos analisados               | 2.589         | 2.589                           |
| 🔴 / 🟡 / 🟢                      | 3 / 1.005 / 0 | 3 / 1.005 / 0                   |
| Saúde simples                     | 0%            | 0%                              |
| Saúde ponderada (`V/(V+R+A×0,3)`) | não existia   | 0%                              |
| Saúde de campo (R1–R3)            | não existia   | 0%                              |
| Cobertura por regra               | não existia   | sim (tabela abaixo)             |
| Perfil aplicado                   | não existia   | `balanced`                      |
| Scan completo (cache frio)        | 88,3 s        | 34,3 s                          |
| Scans incrementais                | 15–22 s       | 12,8–17,2 s                     |
| Itens no roadmap                  | não existia   | 153 (2 binding p1, 151 debt p2) |

As contagens não mudaram porque as correções da Etapa 5 foram de robustez (dedupe, migração, cobertura, roadmap) e não de extração. Os tempos caíram porque o cache por hash/extractor já estava quente depois da revalidação da Etapa 4.

Perfis medidos no mesmo projeto:

| Perfil     | 🔴 / 🟡 / 🟢  | Observação                                                                                        |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `strict`   | 3 / 1.013 / 0 | R10 liga e adiciona 8 amarelas de métodos HTTP sem rota declarada.                                |
| `balanced` | 3 / 1.005 / 0 | default; R9/R10 desligadas.                                                                       |
| `lenient`  | 3 / 1.005 / 0 | R5/R6 continuam ligadas: o front importa cliente HTTP tipado, então o gate do perfil não dispara. |

O resultado do `lenient` é esperado: o perfil só desliga R5/R6 quando **não** há cliente HTTP tipado (`axios`/`ky`/`got`/`superagent`); o SythaxSystem tem imports desse tipo, logo o perfil se comporta como `balanced`. Não é um bug, é o gate projetado.

### Cobertura por regra

| Regra | Avaliados | Ignorados |  🔴 |  🟡 | Nota                                       |
| ----- | --------: | --------: | --: | --: | ------------------------------------------ |
| R1    |         0 |       369 |   0 |   0 | front sem formulários/payloads detectáveis |
| R2    |        99 |     4.112 |   3 |   0 | DTO × coluna                               |
| R3    |     4.485 |       576 |   0 |  83 | entidade × migration                       |
| R4    |        62 |         8 |   0 |   0 | —                                          |
| R5    |       938 |         7 |   0 | 875 | endpoints sem consumidor                   |
| R6    |        67 |         0 |   0 |  47 | entidade sem tela                          |
| R7    |         3 |       168 |   0 |   0 | —                                          |
| R8    |         0 |       145 |   0 |   0 | —                                          |
| R9    |         0 |         0 |   0 |   0 | desligada em `balanced`                    |
| R10   |         0 |         0 |   0 |   0 | desligada em `balanced`                    |

A cobertura deixa explícito por que R5 domina o total: 938 endpoints foram de fato avaliados, contra 99 DTOs em R2. Sem essa coluna, 875 amarelas de R5 pareciam o mesmo tipo de ruído que 3 vermelhas de R2.

### Roadmap gerado

| Tipo      | Prioridade | Itens |
| --------- | ---------- | ----: |
| `binding` | p1         |     2 |
| `debt`    | p2         |   151 |
| `test`    | p2         |     0 |

Os dois itens p1 agrupam as três vermelhas por entidade, exatamente como o gerador determinístico especifica:

1. `Amarrar estoque_contagem_linha entre as camadas` — módulo `replenishment`, evidências `EstoqueContagemLinhaRequest.java:8` e `EstoqueContagemLinhaEntity.java:24`.
2. `Amarrar fin_conta_gerencial entre as camadas` — módulo `accounting`, evidências `FinContaGerencialDTO.java:9` e `FinContaGerencial.java:21`.

Os 151 itens de débito vieram de `TODO`/`FIXME`/`HACK`; nenhum arquivo quente sem teste entrou porque o gerador de teste depende de histórico Git e o recorte não teve candidatos acima do limiar. Nenhum item manual foi criado ou apagado durante a revalidação.

### Nova amostra de 30 pendências

Amostra estratificada proporcional à população ativa (R5 ≈ 87%), sem reutilizar os 20 itens da Etapa 4, mais censo das 3 vermelhas de R2 (são todas).

|   # | Regra | Pendência                                                                     | Veredito | Evidência                                                                                                                    |
| --: | ----- | ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
|   1 | R3    | `atacarejo_pdv_cancelamento_otp.*`                                            | ✅       | entidade `@Table(name = "atacarejo_pdv_cancelamento_otp")`; nenhuma migration com esse nome                                  |
|   2 | R3    | `fiscal_rtc_classificacao.data_atualizacao`                                   | ✅       | migration `V20260101_65...sql:20` tem a coluna; entidade tem só `atualizado_em` (`:62`)                                      |
|   3 | R3    | `tax_transaction.cfop`                                                        | ❌ FP    | `TaxTransaction.java:78-79` tem `@Column(name = "cfop") private String cfop`; migration p10 `:67` também tem                 |
|   4 | R5    | `ajuda.POST /api/v1/public/ajuda/perguntar`                                   | ❌ FP    | `help/app.js:142` monta `base + "/api/v1/public/ajuda/perguntar"` e consome em `:175`                                        |
|   5 | R5    | `atacarejo.GET /api/v1/atacarejo/pedidos-balcao/:param/cobranca-pix/status`   | ✅       | nenhuma referência a `cobranca-pix` no front                                                                                 |
|   6 | R5    | `auth.GET /api/v1/auth/eligibility`                                           | ✅       | nenhuma referência a `eligibility` no front                                                                                  |
|   7 | R5    | `cadastro.GET /api/v1/cadastros/clientes/por-documento`                       | ✅       | nenhuma referência a `por-documento`                                                                                         |
|   8 | R5    | `cadastro.GET /api/v1/cadastros/pontos-venda`                                 | ✅       | nenhuma referência a `pontos-venda`                                                                                          |
|   9 | R5    | `cadastro.PATCH /api/v1/cadastros/frota/veiculos/:param/ativar`               | ✅       | helper `ativar(path,id)` existe (`cadastro-mestre-api.js:196`), mas nenhum chamador passa `frota/veiculos`                   |
|  10 | R5    | `cadastro.POST /api/v1/cadastros/clientes/:param/avaliar-bloqueio-automatico` | ✅       | nenhuma referência a `avaliar-bloqueio`                                                                                      |
|  11 | R5    | `cadastro.POST /api/v1/cadastros/usuarios`                                    | ❌ FP    | `acesso-admin.js:957` faz exatamente esse POST                                                                               |
|  12 | R5    | `cognitive.GET /api/v1/cognitive/capabilities/:param`                         | ✅       | nenhuma referência a `cognitive/capabilities`                                                                                |
|  13 | R5    | `commercial.POST /api/v1/commercial/contracts/:param/approve`                 | ✅       | nenhuma chamada de API commercial no front                                                                                   |
|  14 | R5    | `cotacoe.GET /api/v1/cotacoes/:param`                                         | ✅       | nenhuma referência a `cotacoes` no front                                                                                     |
|  15 | R5    | `estoque.GET /api/v1/estoque/operacional/contagens`                           | ❌ FP    | `estoque-conferencia-api.js:95` faz `GET /contagens` com `BASE = "/api/v1/estoque/operacional"` (`:6`)                       |
|  16 | R5    | `estoque.POST /api/v1/estoque/transferencias/:param/receber`                  | ✅       | front só cria transferência (`compras-pedido-assessoria.js:302`); nunca chama `/receber`                                     |
|  17 | R5    | `finance.POST /api/v1/finance/reconciliation/divergencias/:param/ignorar`     | ✅       | `divergencias` no front é só aba de inbox fiscal; não há chamada de API                                                      |
|  18 | R5    | `financeiro.PATCH /api/v1/financeiro/contratos-recorrentes/:param/retomar`    | ✅       | front usa `POST .../retomar` (`contratos-recorrentes.js:358`); o PATCH fica sem consumidor — provável bug de método no front |
|  19 | R5    | `financeiro.PUT /api/v1/financeiro/despesas-fixas/:param`                     | ✅       | front usa GET/POST/PATCH (`dre-360.js:517,538,565`), não PUT                                                                 |
|  20 | R5    | `fiscal.GET /api/v1/fiscal/layouts/logo`                                      | ❌ FP    | `layout-logo.js:38` faz GET no mesmo `ENDPOINT`                                                                              |
|  21 | R5    | `fiscal.POST /api/v1/fiscal/entradas-xml/:param/confirmar`                    | ❌ FP    | `nf-entrada-sefaz.js:194` faz exatamente esse POST                                                                           |
|  22 | R5    | `fiscal.PUT /api/v1/fiscal/layouts/cupom`                                     | ❌ FP    | `cupom-layout-ui.js:144-145` faz PUT no mesmo caminho                                                                        |
|  23 | R5    | `hcp.GET /api/v1/hcp/payroll/convenios`                                       | ✅       | nenhuma referência a payroll/convenios no front                                                                              |
|  24 | R5    | `integracao.POST /api/v1/integracao/hub/conexoes/:param/desconectar`          | ❌ FP    | `integracoes-hub.js:397,497` chama POST `/conexoes/:id/desconectar`                                                          |
|  25 | R5    | `marketing.GET /api/v1/marketing/produtos/:param/sync-status`                 | ✅       | a única ocorrência de `sync-status` é um id de DOM (`fis-cfg-sync-status`)                                                   |
|  26 | R5    | `portal.POST /api/v1/portal/pedidos`                                          | ✅       | `portal/` é site de planos/checkout, sem consumo da API do ERP                                                               |
|  27 | R5    | `sale.PUT /api/v1/sales/order/:param/cancel`                                  | ✅       | front cancela via POST `/api/v1/vendas/pedidos-comerciais/:id/cancelar` (`pedido-comercial-api.js:356`)                      |
|  28 | R5    | `sythaxtech.POST /api/v1/public/sythaxtech/assinatura/iniciar`                | ✅       | `sythaxtech` no front é só chave de `sessionStorage`                                                                         |
|  29 | R5    | `venda.POST /api/v1/vendas/comercial/:param/estornar`                         | ✅       | o estorno em `telas-locais.js:9442` é local (localStorage), sem chamada de API                                               |
|  30 | R6    | `ajuda.*`                                                                     | ❌ FP    | `help/app.js` consome a API de perguntas; existe tela dedicada                                                               |

Censo R2 (todas as 3 vermelhas):

| Pendência                                   | Veredito | Evidência                                                                                                  |
| ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `estoque_contagem_linha.codigo_produto`     | ✅       | DTO tem `codigoProduto` (`:9`); entidade tem `codigo` (`:42`) e `produto_id` (`:36`), não `codigo_produto` |
| `estoque_contagem_linha.quantidade_contada` | ✅       | DTO tem `quantidadeContada` (`:11`); entidade persiste `saldo_contado` (`:51`)                             |
| `fin_conta_gerencial.plano_conta_codigo`    | ✅       | DTO tem `planoContaCodigo` derivado (`:17`); entidade só tem `plano_conta_id` (`:35`)                      |

### Precisão

| Regra | Ativos | Amostrados | Corretos |                                        Precisão |
| ----- | -----: | ---------: | -------: | ----------------------------------------------: |
| R2    |      3 |   3 (cens) |        3 |                                            100% |
| R3    |     83 |          3 |        2 |                                           66,7% |
| R5    |    875 |         26 |       19 |                                           73,1% |
| R6    |     47 |          1 |        0 |                                              0% |
| Total |  1.008 | 30 + censo |    24/33 | 72,7% bruta · **≈69% ponderada** pela população |

A precisão ponderada usa os ativos de cada regra (R5 responde por 87% do total), por isso fica próxima da precisão de R5. A amostra de R3 (3 itens) e R6 (1 item) é pequena demais para conclusão forte; o valor de R6 é um alerta, não uma medida.

### Leitura dos falsos positivos restantes

Todos os 7 FPs de R5 e o FP de R6 têm a mesma causa: **URL indireta no front vanilla**. O detector reconhece `base + "/api/..."` literal, mas ainda perde quando a URL:

- é devolvida por uma função (`help/app.js:142`);
- é montada com constante de caminho (`layout-logo.js:9`, `cupom-layout-ui.js:4`);
- é montada com `encodeURIComponent` no meio (`nf-entrada-sefaz.js:194`, `integracoes-hub.js:397`);
- é centralizada num wrapper (`estoque-conferencia-api.js:95`, `acesso-admin.js:957`).

O FP de R3 (`tax_transaction.cfop`) é de outra natureza: a entidade está no módulo `ats`, mas a migration foi classificada em `accounting`; o confronto entre módulos diferentes perdeu a coluna. As regras de campo (R1/R2/R3) seguem com precisão alta fora desse caso cross-module, e as três vermelhas continuam sendo divergências reais de contrato.
