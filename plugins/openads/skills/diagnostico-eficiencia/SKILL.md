---
name: diagnostico-eficiencia
description: "Faça um diagnóstico integrado de eficiência no Google Ads e proponha contramedidas para revisão humana. Use também quando a pessoa chamar /openads:diagnostico-eficiencia."
---

# OpenAds — diagnostico-eficiencia

Leia [o protocolo de acesso](../../references/api.md) antes de consultar dados.

Use o comando `diagnostico-eficiencia` no cliente, que reúne campanhas, termos de busca, palavras-chave e dispositivos da mesma conta e período. Se a pessoa informar uma meta de CPA, passe-a como `--target-cpa`; ela serve apenas de contexto para a análise e não é enviada ao Google.

Comece separando quatro blocos: campanhas, termos, palavras-chave e dispositivos. Não some custos entre blocos, pois são visões sobrepostas da mesma conta. Calcule CPA apenas para itens com conversões; ausência de conversão não prova desperdício. Considere atraso de conversão, volume insuficiente, sazonalidade, tipo de campanha, estratégia de lances e possíveis falhas de medição antes de propor corte.

Entregue, nesta ordem:

1. Diagnóstico principal em até três frases.
2. Tabela de prioridades com: achado, evidência, contramedida reversível, risco, confiança e dado que falta para decidir.
3. Separe “economizar”, “proteger conversões”, “testar crescimento” e “corrigir medição”.
4. Próximo passo seguro: investigar, criar experimento, revisar configuração ou solicitar confirmação explícita para qualquer escrita.

Nunca chame uma economia estimada de economia realizada e nunca aplique pausas, lances, negativas ou orçamento. Todo número deve identificar Google Ads API, conta, período e moeda da conta.
