---
name: analise-termos
description: "Analise as buscas reais que acionaram anúncios no Google Ads. Use também quando a pessoa chamar /openads:analise-termos."
---

# OpenAds — analise-termos

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Separe termo de pesquisa de palavra-chave comprada. Priorize gasto e relevância para o negócio. Avise que o Google pode omitir termos e que o total deste relatório pode diferir do total da conta.

Relatório correspondente no cliente: `termos`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
