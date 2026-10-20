---
name: ajuda
description: "Explique os comandos OpenAds e ajude a usar a API oficial. Use também quando a pessoa chamar /openads:ajuda."
---

# OpenAds — ajuda

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Liste os comandos do plugin e exemplos em linguagem simples. Para instalar ou configurar o painel, encaminhe à skill instalar-painel do repositório e siga INSTALL.md; a pessoa escolhe Angular Oficial ou React. Não é preciso escolher uma stack para fazer análises.

Relatório correspondente no cliente: `ajuda`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
