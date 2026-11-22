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
| Saúde                           | **0%**                                              |
| Total ativo                     | 1.008                                               |

Evolução: o primeiro passe, com os padrões genéricos e sem tuning de projeto, produziu **4.714 pendências (982🔴 / 3.732🟡)**. Depois dos ajustes de extractors, regras e config, caiu para **1.008 (3🔴 / 1.005🟡)** — redução de ~79%.

Por regra:

| Regra | Total |  🔴 |  🟡 |
| ----- | ----: | --: | --: |
| R2    |     3 |   3 |   0 |
| R3    |    83 |   0 |  83 |
| R5    |   875 |   0 | 875 |
| R6    |    47 |   0 |  47 |

R1, R4, R7, R8, R9 e R10 não geraram pendências ativas neste recorte.

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
