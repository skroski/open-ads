---
name: pesquisa-palavras-chave
description: "Busque ideias de palavras-chave no Planejador oficial do Google Ads. Use também quando a pessoa chamar /openads:pesquisa-palavras-chave."
---

# OpenAds — pesquisa-palavras-chave

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Peça sementes ou URL HTTPS, idioma e mercado quando faltarem. Use --keywords com sementes separadas por vírgula e/ou --url; --language e --geo recebem resource names oficiais. Volume é estimativa do Planejador e concorrência é de anúncios, não dificuldade SEO. Se o acesso ao Planejador for recusado, explique a limitação sem inventar resultados.

Relatório correspondente no cliente: `ideias`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
