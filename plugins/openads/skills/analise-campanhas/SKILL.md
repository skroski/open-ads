---
name: analise-campanhas
description: "Compare campanhas Google Ads com dados da API oficial. Use também quando a pessoa chamar /openads:analise-campanhas."
---

# OpenAds — analise-campanhas

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Compare campanhas por objetivo e tipo, sem tratar canais distintos como equivalentes. Apresente custo, conversões e CPA. Considere atraso de conversão antes de sugerir cortes.

Relatório correspondente no cliente: `campanhas`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
