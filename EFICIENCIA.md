# Eficiência da mídia

Na versão oficial Angular, abra **Inteligência → Eficiência da mídia** (`/eficiencia`). A análise começa em Display. Escolha outro formato, uma campanha e o período no seletor global. O link também aceita `?format=SEARCH&dim=term`.

## Como o cliente lê a tela

1. **Sua leitura do período:** investimento observado, gasto que merece revisão, gasto ainda sem conclusão e gasto dentro da referência. Os totais usam somente campanhas; não somam páginas, posicionamentos ou horários.
2. **Onde olhar primeiro:** medição, sinais de desperdício, custo acima da referência, falta de dados e resultados a preservar. Dentro de cada prioridade, aparece primeiro o maior gasto.
3. **Próximo passo:** orientação específica para campanha, posicionamento, anúncio, página, termo, palavra-chave, região, dispositivo ou horário.
4. **Entender os dados:** fatos com fonte, hipóteses, lacunas, confiança, período, premissas e como validar a mudança. A exportação CSV preserva essas informações e distingue resultado desconhecido de zero.

## Critérios e limites

- O mínimo de cliques configurado é apenas uma primeira barreira. Zero resultados ainda depende de referência comparável, janela completa e outro sinal observado. Uma hipótese sobre aplicativos ou intenção não confirma desperdício.
- Sinais com o mesmo mecanismo contam uma vez. Linhas imaturas ou com indício de falha de medição ficam fora da referência estatística. Taxas de conversões por clique iguais ou superiores a 100% não alimentam o teste binomial de zero.
- Sem coortes de cliques por data, dias ou custo já maduros não permitem concluir que todos os cliques amadureceram. Análises de desempenho aguardam a janela completa; regras explícitas de negócio continuam identificadas como configuração.
- Campanhas são comparadas com outras do mesmo formato. Anúncios, termos, palavras e posicionamentos usam referências da mesma campanha. A falta de referência não é compensada misturando formatos.
- A média de formatos diferentes não vira meta de CPA. Quando não há meta explícita, a nova visão usa uma média apenas em um formato selecionado; no total da conta solicita uma meta.
- Nos recortes sem conversões por ação, o agregado do Ads só representa a meta quando todas as ações primárias contadas têm esse estágio confirmado. No nível de campanha, conversões com estágio ainda não confirmado não sustentam conclusão. Importar alguns leads com termo não comprova a cobertura de todos os termos: não se infere zero para os demais.
- Regiões e dispositivos são coletados no total da conta; aparecem somente com todos os formatos e campanhas selecionados. Não há rateio desses dados para Display.
- O GA4 entra como contexto por caminho, com sessões, sessões engajadas e eventos principais de todas as origens da propriedade. O relatório atual não informa domínio nem campanha. Ausência de uma linha não é zero sessões; baixo engajamento não prova público pago inadequado. Eventos do GA4 não são somados às conversões do Ads.
- A leitura do site mostra o momento da consulta e o que foi encontrado no HTML. Ela não reproduz conteúdo carregado por JavaScript nem a página histórica. A compatibilidade entre busca, anúncio e página é hipótese a revisar.
- Custo na meta não significa lucro. Qualificação, vendas, receita e retorno dependem de registros confiáveis e vinculados. Ads, Analytics e CRM podem ter diferenças de janela, data, fuso, consentimento e atribuição.
- O prazo usado é o configurado para o negócio, não uma janela efetivamente consultada no Google Ads. Novas fontes de atraso e atribuição devem preservar essa distinção.

## Impacto financeiro

Não há previsão automática de economia futura. Para itens acima da meta com confiança alta, ao menos dez resultados conhecidos e meta explícita, a tela permite uma comparação histórica:

`diferença = gasto observado − quantidade de resultados × meta de custo`

Esse cenário pressupõe a mesma quantidade de resultados ao custo da meta, no período informado. Não demonstra que uma alteração produzirá esse efeito. Nos demais casos, o impacto permanece **não estimado**. O plano de ação também deixou de converter simples mensalização do gasto em economia prevista.

## Cobertura atual e evolução

Disponível: campanhas por formato, posicionamentos, anúncios, busca, páginas, horários e fontes conectadas já existentes no projeto. Nenhuma recomendação nesta tela escreve nas plataformas.

Ainda não coletado nesta análise: segmentos, interesses, dados demográficos, alcance/frequência, orçamento configurado e estratégia de lance. Também falta ligação do GA4 por campanha/posicionamento e cobertura completa de qualidade por entidade. Esses dados aparecem como limites explícitos, sem valores simulados. Outras plataformas de anúncios não foram conectadas por esta implementação.

Para ampliar, acrescente os conectores e os vínculos de entidade antes de criar novos vereditos; depois valide paridade de período, moeda, fuso, atribuição e cobertura. A versão React permanece independente e ainda não recebeu a nova tela; o domínio puro continua compartilhado.

Referências da plataforma: [atrasos e diferenças de medição](https://support.google.com/google-ads/answer/7457111), [atualização dos dados](https://support.google.com/google-ads/answer/2544985), [relatórios de posicionamento](https://developers.google.com/google-ads/api/docs/reporting/placement-views).
