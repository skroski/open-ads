---
name: sugestao-negativas
description: "Prepare sugestões de palavras negativas com base em termos reais. Use também quando a pessoa chamar /openads:sugestao-negativas."
---

# OpenAds — sugestao-negativas

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Sugira negativas apenas quando a intenção for incompatível com o negócio. Mostre termo, motivo, correspondência e escopo proposto. Informe que a cobertura de negativas existentes não foi consultada por este relatório e precisa ser verificada antes da aplicação. Não aplique alterações.

Relatório correspondente no cliente: `termos`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
