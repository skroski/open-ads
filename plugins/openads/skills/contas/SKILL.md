---
name: contas
description: "Liste as contas disponíveis e ajude a escolher a conta do Google Ads. Use também quando a pessoa chamar /openads:contas."
---

# OpenAds — contas

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Mostre ID, nome, status e se é MCC. Se houver várias contas, peça a escolha; não confunda MCC com conta anunciante.

Relatório correspondente no cliente: `contas`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
