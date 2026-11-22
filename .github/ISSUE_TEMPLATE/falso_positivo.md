---
name: Falso positivo de amarração
about: Uma regra R1–R10 apontou uma pendência que não existe
title: 'falso positivo: '
labels: [bindings, false-positive]
---

## Regra e item

- Regra: <!-- R1…R10 -->
- Entidade: <!-- ex.: user -->
- Campo: <!-- ex.: phone (se aplicável) -->
- Saída de `vigiacode bindings list --rule R1 --entity user`:

```text
<!-- cole aqui a linha da amarração -->
```

## Por que é falso positivo

<!-- Ex.: campo vem de projeção SQL, o front usa outro cliente HTTP, o DTO é gerado… -->

## Trechos de código

<!-- Referências arquivo:linha do front, back e banco envolvidos, sem segredos. -->

## Config atual

```json
{ "bindings": { "profile": "balanced", "r1IncludeTypes": true } }
```

## Sugestão

- [ ] `acceptedFalsePositives` resolve para este caso
- [ ] Precisa de ajuste na regra/extractor
- [ ] Precisa de novo perfil/configuração
