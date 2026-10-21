---
name: ajuda
description: "Explique os comandos OpenAds e ajude a usar a API oficial. Use também quando a pessoa chamar /openads:ajuda."
---

# OpenAds — ajuda

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Liste os comandos do plugin e exemplos em linguagem simples. Para instalar ou configurar o painel, encaminhe à skill instalar-painel do repositório e siga INSTALL.md; a pessoa escolhe Angular Oficial ou React. Não é preciso escolher uma stack para fazer análises.

Apresente estes comandos, agrupados por objetivo:

| Objetivo | Comando | Resultado |
|---|---|---|
| Começar | `/openads:contas` | Lista contas e ajuda a selecionar uma conta anunciante ou MCC. |
| Começar | `/openads:visao-geral` | Resume investimento, cliques, conversões, CPC e CPA por campanha. |
| Diagnosticar | `/openads:diagnostico-eficiencia` | Cruza campanhas, termos, palavras-chave e dispositivos para encontrar pontos de investigação e contramedidas. |
| Diagnosticar | `/openads:analise-desperdicios` | Investiga gasto potencialmente ineficiente, sem tratar falta de conversão como prova isolada. |
| Diagnosticar | `/openads:analise-campanhas` | Compara campanhas por custo, conversões e CPA. |
| Diagnosticar | `/openads:analise-dispositivos` | Compara custo e resultado por dispositivo. |
| Diagnosticar | `/openads:auditoria-medicao` | Revisa a configuração de ações de conversão e o contexto de desempenho das campanhas. |
| Diagnosticar | `/openads:auditoria-mudancas` | Mostra mudanças recentes registradas pelo Google Ads; o intervalo máximo é de 30 dias. |
| Agir com segurança | `/openads:oportunidades` | Prioriza oportunidades de economia, crescimento, mensuração ou teste, sempre para revisão humana. |
| Agir com segurança | `/openads:analise-termos` | Analisa buscas reais que acionaram anúncios. |
| Agir com segurança | `/openads:sugestao-negativas` | Propõe negativas para revisão; nunca aplica alterações. |
| Crescer | `/openads:analise-palavras-chave` | Analisa desempenho, qualidade e aderência das palavras compradas. |
| Crescer | `/openads:pesquisa-palavras-chave` | Busca ideias, volume, concorrência e faixas de CPC no Planejador oficial. |

Explique que os quatro comandos novos — `diagnostico-eficiencia`, `oportunidades`, `auditoria-medicao` e `auditoria-mudancas` — são somente de leitura e retornam evidências para o assistente analisar. Eles não aplicam recomendações, pausas, negativas, lances ou orçamentos.

Use exemplos como:

```text
/openads:diagnostico-eficiencia últimos 30 dias da conta 1234567890; minha meta de CPA é R$ 80
/openads:oportunidades onde posso economizar sem arriscar as conversões?
/openads:auditoria-medicao confira se estou otimizando para as conversões certas
/openads:auditoria-mudancas o que foi alterado na conta nos últimos 14 dias?
```

Relatório correspondente no cliente: `ajuda`. Use o cliente em `../../scripts/openads.mjs`, resolvendo o caminho a partir desta skill. Receba conta, período e contexto da mensagem da pessoa; pergunte apenas o que faltar e mudar a análise.

Entregue a conclusão principal, uma tabela com os dados relevantes, limitações e próximos passos. Identifique fonte, conta, período e unidade dos números. Separe fatos de hipóteses e propostas. Para `ajuda`, basta explicar os comandos, sem acessar a API.
