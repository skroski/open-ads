---
name: analise-dispositivos
description: "Compare desempenho do Google Ads por dispositivo. Use também quando a pessoa chamar /openads:analise-dispositivos."
---

# OpenAds — analise-dispositivos

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Compare custo, cliques, conversões e CPA por dispositivo. Não recomende ajustes de lance sem verificar estratégia de lances e volume da amostra.

Relatório correspondente no cliente: `dispositivos`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
