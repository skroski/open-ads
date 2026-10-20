---
name: analise-desperdicios
description: "Investigue gastos potencialmente desperdiçados no Google Ads. Use também quando a pessoa chamar /openads:analise-desperdicios."
---

# OpenAds — analise-desperdicios

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Trate gasto sem conversão como candidato a investigação, não como desperdício comprovado. Peça meta de CPA e contexto do negócio quando necessários. Considere maturação, rastreamento e cobertura parcial de termos. Não some gastos sobrepostos entre dimensões.

Relatório correspondente no cliente: `termos`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
