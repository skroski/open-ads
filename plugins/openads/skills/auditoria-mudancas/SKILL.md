---
name: auditoria-mudancas
description: "Investigue mudanças recentes na conta Google Ads e prepare uma auditoria de causa e efeito. Use também quando a pessoa chamar /openads:auditoria-mudancas."
---

# OpenAds — auditoria-mudancas

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Use o comando `auditoria-mudancas` no cliente com um período de no máximo 30 dias. Ele consulta `change_event`, que registra alterações recentes; a ausência de um evento não prova que nada mudou, e o relatório não demonstra causalidade no desempenho.

Agrupe alterações por data, tipo de recurso, operação, campanha/grupo e origem do cliente. Explique os campos alterados sem extrapolar seu significado. Para correlacionar uma mudança com resultado, peça ou consulte um período comparável e descreva o resultado como hipótese até haver amostra e controle suficientes.

Entregue uma linha do tempo, riscos que merecem revisão e sugestões de documentação para cada mudança. Não reverta, pause, altere lance, orçamento, negativas ou qualquer outro recurso.
