---
name: visao-geral
description: "Analise o desempenho geral de uma conta Google Ads. Use também quando a pessoa chamar /openads:visao-geral."
---

# OpenAds — visao-geral

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Resuma investimento, cliques e conversões por campanha. Calcule CTR, CPC e CPA a partir dos totais; CPA sem conversão é indefinido. Não some médias.

Relatório correspondente no cliente: `campanhas`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
