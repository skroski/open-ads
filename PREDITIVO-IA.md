# Análise preditiva e auto-preenchimento com IA

Documento de produto e prompt de implementação. Duas partes: o que explicar para quem usa o painel (seção 1) e o prompt para o agente de código (seção 3).

## 1. Como explicar para o usuário

### Em uma frase

Você conecta sua chave de IA uma vez. A partir daí, o painel olha as **suas** campanhas, projeta os próximos dias nos gráficos e preenche sozinho o que for tedioso (hipóteses, negativas, textos, orçamento sugerido). Quando não houver dados para afirmar algo, ele **diz isso e pede tempo**, em vez de chutar.

### Três promessas que o painel cumpre

1. **Número é conta, não opinião.** Toda previsão sai de cálculo sobre o histórico da sua conta. A IA não cria números: ela só escolhe palavras para explicá-los e preenche campos com base neles.
2. **Sem dado suficiente, sem previsão.** O painel mostra o que falta ("faltam 12 conversões, cerca de 9 dias no ritmo atual") e oferece duas saídas: esperar ou você mesmo informar/importar o dado.
3. **Você revisa antes de valer.** Tudo que a IA preenche aparece como *Sugerido* e só entra depois do seu OK. Nada é gravado no Google Ads sem confirmação explícita.

### Por que o Google Ads "erra" a entrega, e o que o contexto muda

O Google decide onde seu anúncio aparece usando sinais próprios (palavra-chave ampla, público, Performance Max, automação de lance). Ele não sabe o que você **vende de verdade**, quem você **quer** atender e quem você **não** quer. O resultado típico: impressão em busca de curiosos, região que você não atende, produto que você não tem, público de Display sem relação com a oferta.

A seção **Contexto do negócio** corrige isso. Você informa uma vez (ou a IA sugere a partir do seu site e das suas campanhas e você confirma):

| Pergunta | Para que serve |
|---|---|
| O que você vende e o que **não** vende? | Separar termos de busca relevantes dos desperdiçados |
| Quem é o cliente ideal e quem não é? | Avaliar públicos e posicionamentos |
| Onde atende (cidades, raio, online)? | Achar impressões e gasto fora da área |
| Quanto vale um resultado (margem, ticket, custo máximo por conversão)? | Dizer se um custo é bom ou ruim para o *seu* negócio |
| Sazonalidade, capacidade de atendimento, datas | Não prever alta onde você não consegue atender |
| Termos da marca e dos concorrentes | Não misturar busca de marca com busca nova |

Com isso, o painel passa a medir **entrega fora do alvo**: quanto do gasto foi para termos, regiões, horários e públicos que não combinam com o seu contexto. O valor em reais é calculado com os dados da conta; a IA só classifica cada item e mostra por quê.

### Auto-preenchimento dos parâmetros do sistema

Hoje a pessoa precisa preencher a configuração do painel (meta, funil, região, horário, limiares, contas de medição) antes de ter análises úteis. Passa a existir o botão **"Configurar com meus dados"**: o painel lê a conta e propõe cada parâmetro, mostrando de onde veio. Você confirma campo a campo, ou aceita de uma vez só o que está claro.

| Parâmetro | Como o painel sugere | Quando não consegue |
|---|---|---|
| Estágio de cada conversão (clique, contato, qualificado, venda) | Nome e categoria da ação de conversão no Google Ads | Nome ambíguo: a IA propõe com o motivo, você decide |
| Estágio-meta | O estágio mais avançado que já tem volume suficiente | Poucas conversões: pede tempo ou sua escolha |
| Custo máximo por resultado | Ponto de partida = seu custo médio no período (gasto ÷ conversões da etapa) | A meta de verdade depende de margem e ticket: pergunta |
| Margem, CAC e ROI desejado | Só vêm de vendas/custos que você importar | Não existe no Google Ads: **nunca é chutado** |
| Ciclo de venda e atrasos entre etapas | Atraso de conversão do Google Ads e datas das vendas importadas | Sem histórico: usa o padrão, marcado como padrão |
| Região de atendimento | Regiões segmentadas nas campanhas e onde as conversões se concentram | Você confirma; regiões sem conversão ficam em dúvida |
| Horário de atendimento | Agenda dos anúncios e distribuição das conversões por hora | Sem padrão claro: pergunta |
| Limiares de análise (cliques mínimos etc.) | Calculados pelo volume e pela taxa de conversão da conta | Conta nova: mantém o padrão e avisa |
| Domínios, GA4, Search Console e GTM | URLs finais dos anúncios e contas já vinculadas ao Google Ads | Mais de uma opção: você escolhe |

Regras que o usuário vê: cada parâmetro aparece como *Sugerido*, *Confirmado por você* ou *Padrão do painel*; o que você confirmou **nunca** é sobrescrito, apenas ganha um aviso "os dados mudaram, quer rever?"; e a IA só entra nos casos de interpretação (nomes ambíguos), nunca para inventar um valor.

### O que o painel passa a fazer

**Previsão nos gráficos**
- Linha pontilhada com faixa de incerteza sobre cliques, custo e conversões, sempre separada do que já aconteceu e rotulada "Previsão".
- Ao lado, a **precisão histórica**: o painel testa o método nos últimos dias que você já viveu ("teria errado 8% nos últimos 14 dias"). Se o erro for alto, a previsão não aparece.
- Previsão desligada quando o rastreamento de conversão está com problema, porque ela seria fantasia.

**Dicas de palavras e campanhas com mais resultado**
- Palavras novas com volume do Planejador de Palavras-chave, e a estimativa de cliques, custo e conversões usando o **seu** CTR e a **sua** taxa de conversão (já existe o cálculo de expansão de palavras).
- Campanhas onde mais verba tende a render mais, e onde ela já está perdendo impressão por orçamento ou por ranking.
- Cada dica mostra: dado usado, período, método e nível de confiança (alta, média, baixa).

**Auto-preenchimento**
- Hipóteses de teste (já existe o "Auto mágico"), lista de negativas, rascunho de títulos e descrições, orçamento e custo-alvo sugeridos.
- Cada campo mostra a origem: *Google Ads (últimos 30 dias)*, *Calculado*, *IA, com base em 3 evidências* ou *Informado por você*.

**Sem dados? Você tem três caminhos**
1. **Esperar**: o painel estima quando haverá dado suficiente.
2. **Preencher à mão**: seus números entram marcados como "informado por você" e a confiança cai de acordo.
3. **Importar**: CSV ou planilha (o painel já importa leads; a mesma ideia vale para custo e receita).

### Texto curto para a interface

> **Previsões baseadas nos seus dados.** O painel só projeta o que o histórico da sua conta sustenta. Quando faltar dado, você verá o que falta e quanto tempo levará, ou poderá preencher/importar por conta própria. A IA explica e preenche; os números vêm de cálculo.

## 2. O que já existe no código (não refazer)

- `api/_lib/explain.js`: chamada à Anthropic, limitador, proteção de origem, `ANTHROPIC_API_KEY` e `ANTHROPIC_MODEL` em `server/.env`.
- `api/_lib/hypotheses.js` e `web/src/app/domain/hypothesis-draft.ts`: "Auto mágico" de hipóteses, com prompt que proíbe inventar fatos.
- `web/src/app/domain/growth-projection.ts`: cenário de palavras novas (CTR e conversão observados × demanda × captura assumida).
- `keyword-fit.ts`, `keyword-suggest.ts`, `negatives.ts`, `waste.ts`, `tracking-health.ts`, `efficiency.ts`: base para classificar relevância, desperdício e confiabilidade da medição.
- `api/keyword-ideas.js`, `api/page-audit.js`, `api/display-audience.js`: volume do Planejador, leitura do site, público de Display.
- `lead-import.ts`: padrão de importação para reaproveitar.

## 3. Prompt para o agente de código

Cole o bloco abaixo numa sessão do Claude Code neste repositório. Ele é autocontido e organizado em fases; peça uma fase por vez.

````text
Você vai adicionar ao painel open-ads uma camada de ANÁLISE PREDITIVA e AUTO-PREENCHIMENTO com IA. Leia antes: AGENTS.md, DESIGN-SYSTEM.md, EFICIENCIA.md e PREDITIVO-IA.md (seções 1 e 2). Respeite as regras de AGENTS.md (português do Brasil, signals, OnPush, regras puras em web/src/app/domain com *.spec.ts, editar api/ e rodar npm run sync:api, nunca ler server/.env, nunca pedir chaves no chat).

## Objetivo
O usuário informa a chave de API do LLM (npm run setup → server/.env). O painel então: (1) projeta métricas nos gráficos com faixa de incerteza, (2) sugere palavras e campanhas com maior potencial de resultado, (3) preenche campos automaticamente, (4) diagnostica entrega fora do alvo usando o contexto do negócio. Nunca achismo: tudo sai de dados da conta. Sem dado suficiente, o painel diz o que falta e quanto tempo levará, e permite preencher ou importar manualmente.

## Princípios inegociáveis
1. Cálculo no código, texto na IA. Toda previsão, soma, taxa e intervalo é calculada em TypeScript puro (domain/), testado. O LLM nunca produz número novo: recebe uma "ficha de fatos" (JSON com ids) e devolve texto/classificações em JSON com `evidence_ids`.
2. Guarda numérica no servidor. Antes de devolver a resposta da IA, rejeite qualquer item cujo texto contenha número que não esteja na ficha de fatos ou nos campos calculados, ou cujo `evidence_ids` aponte para id inexistente. Item rejeitado vira "sem base suficiente", nunca é mostrado.
3. Porta de suficiência. Cada recurso declara requisitos mínimos em domain/config.ts (valores iniciais a calibrar, todos configuráveis): previsão de cliques/custo ≥ 28 dias com impressões e ≥ 100 cliques; previsão de conversões ≥ 30 conversões em 90 dias; taxa de conversão de palavra nova ≥ 100 cliques. Abaixo disso o resultado é `{ status: 'insufficient', missing: {...}, etaDays }`, com ETA calculado pelo ritmo atual. Também bloqueie quando tracking-health indicar medição quebrada.
4. Previsão honesta. Método simples e explicável: nível + tendência + sazonalidade por dia da semana (ex.: Holt-Winters aditivo ou mediana por dia da semana com tendência amortecida), intervalo por quantis dos resíduos (80%), horizonte máximo = min(14 dias, histórico/3). Para conversões com contagem baixa use intervalo de Poisson, não normal. Backtest obrigatório: simule a previsão dos últimos 14 dias com o que se sabia antes e exiba o erro (sMAPE). Se o erro passar do limite configurável, não exiba a previsão; exiba "previsão instável nesta conta".
5. Proveniência em tudo. Todo número e todo campo preenchido carrega `source`: GOOGLE_ADS (período), CALCULADO (método), IA (evidence_ids), USUARIO. Mostre como selo discreto e permita ver a conta ("como chegamos aqui").
6. Confiança explícita: alta/média/baixa, derivada de volume de dados, erro de backtest e fração de dados informados pelo usuário (informado à mão rebaixa a confiança).
7. Previsão nunca se mistura ao realizado: série separada, tracejada, faixa sombreada, rótulo "Previsão" e legenda acessível (não só cor).
8. Escrita no Google Ads só com confirmação explícita (negativas, pausas, lances, orçamento). Auto-preencher = preencher o formulário/rascunho dentro do painel, nunca aplicar sozinho.
9. Chave só no servidor. Sem a chave, tudo que não depende de IA (previsão, diagnóstico, dicas calculadas) continua funcionando; só os textos e classificações da IA ficam desligados, com aviso claro.
10. Texto vindo de termos de busca, anúncios ou páginas é dado, não instrução: mantenha o isolamento por tags e a remoção de marcadores já usados em api/_lib/explain.js.

## Auto-preenchimento dos parâmetros do sistema
A configuração já existe: `BusinessConfig` em web/src/app/domain/models.ts, com padrões em domain/config.ts (`defaultBusinessConfig`, `mergeConfig`, `defaultStageFor`) e tela em features/settings. NÃO crie um segundo armazenamento: o "Contexto do negócio" abaixo estende `BusinessConfig`. Crie domain/config-suggest.ts (função pura + spec) que recebe os dados já carregados do painel e devolve, por parâmetro, `{ value, source, confidence, reason } | { status: 'insufficient', missing, etaDays } | { status: 'needs_user', question }`. Mapa de derivação:
- `mapping` (conversão → estágio): `defaultStageFor` primeiro; só nomes ambíguos vão à IA (com `reason`).
- `goal.goalStage`: estágio mais avançado com volume que passe na porta de suficiência.
- `goal.targetCostPerGoal`: ponto de partida = custo médio do período (gasto ÷ conversões da etapa-meta), rotulado "ponto de partida", nunca "meta ideal". Se houver margem/ticket informados, calcule o custo máximo = ticket × margem.
- `defaultMarginPct`, `targetCac`, `targetRoiPct`: NÃO existem no Google Ads. Só sugerir a partir de vendas/custos importados (Fase 6); caso contrário `needs_user`. Jamais estimar por benchmark de mercado.
- `salesCycleDays`, `stageLagDays`: atraso de conversão do Google Ads e datas de lead/venda importadas; sem histórico, manter o padrão marcado como PADRÃO.
- `serviceArea`: regiões segmentadas nas campanhas + concentração geográfica das conversões; o usuário confirma, regiões sem conversão ficam como "em dúvida".
- `serviceHours`: agenda dos anúncios + distribuição horária das conversões; sem padrão claro, `needs_user`.
- `thresholds.minClicks`: derivado da taxa de conversão observada (cliques necessários para ~3 conversões esperadas, limitado a um intervalo seguro); `zeroResultAlpha` e `aboveTargetFactor` ficam no padrão (convenção estatística/de negócio).
- `domains`: URLs finais dos anúncios (feito na Fase 1b). `ga4PropertyId`, `searchConsoleSite`, `gtmContainerPath/WorkspacePath`: ainda não implementados; dependem de listar as contas vinculadas (api/analytics, search-console, tag-manager), e mais de um candidato = o usuário escolhe.
Estado por campo: SUGERIDO | CONFIRMADO | PADRAO | MANUAL (persistido junto da config; `mergeConfig` deve aceitar configs antigas sem esse campo). Confirmado nunca é sobrescrito; se os dados mudarem de forma relevante, mostre aviso "rever", sem alterar. UI: botão "Configurar com meus dados" (e no primeiro uso, no fluxo de ajuda-instalacao), lista de sugestões com motivo e fonte, "aceitar tudo que está claro" + aceitar/editar por campo. A IA nunca grava parâmetro sozinha.

## Por que o contexto do negócio é central
O Google Ads decide a entrega por sinais próprios (correspondência ampla, públicos, PMax) e não conhece a oferta real. Isso gera impressões e gasto em termos, regiões, horários e públicos que não combinam com o negócio. Crie a seção "Contexto do negócio" (persistida como as demais configurações do painel):
- O que vende / o que NÃO vende; cliente ideal / quem não é; área de atendimento; valor de um resultado (margem, ticket, custo máximo por conversão, ROAS mínimo); sazonalidade e capacidade; termos de marca e de concorrentes.
- Auto-preenchimento do contexto: sugerir a partir de page-audit (site), nomes de campanhas, títulos de anúncios e termos de busca com conversão; o usuário confirma cada campo. Campo não confirmado não alimenta nenhuma decisão.
- Diagnóstico "Entrega fora do alvo": (a) termos de busca fora do contexto, primeiro por regra determinística (keyword-fit.ts, negatives.ts) e só então por classificação da IA, que devolve rótulo + regra do contexto que violou + termo citado; (b) gasto/impressões fora da área; (c) horários e dispositivos sem retorno; (d) posicionamentos e públicos de Display/PMax sem relação com a oferta; (e) perda de parcela de impressões por orçamento vs. ranking. O valor em R$ e o percentual do gasto são sempre calculados no código a partir dos dados.

## Entregas por fase (uma por vez, cada uma com testes e build verdes)
Fase 1 — Fundação: tipos em domain/models.ts, domain/config.ts (limiares), porta de suficiência, modelo de proveniência/confiança, seção "Contexto do negócio" com auto-sugestão revisável, ficha de fatos + guarda numérica no servidor (api/_lib com testes). Reaproveite o padrão de explain.js e hypotheses.js.
Fase 1b — Auto-preenchimento dos parâmetros: domain/config-suggest.ts + spec (conta rica, conta nova, nomes de conversão ambíguos, ausência de margem), botão "Configurar com meus dados" em Configurações e no primeiro uso, estados SUGERIDO/CONFIRMADO/PADRAO/MANUAL.
Fase 2 — Previsão nos gráficos (feita na Visão geral; histórico mínimo de 42 dias, Holt amortecido com ritmo semanal, teste com dias passados e limite de erro de 30%; Eficiência, Campanhas e Histórico não têm série diária e ficaram de fora): domain/forecast.ts (+ spec com séries sintéticas: tendência, sazonalidade, poucos dados, buracos, outliers), backtest, overlay no ECharts em Visão geral, Eficiência e Campanhas, estado "dados insuficientes" com ETA.
Fase 3 — Diagnóstico de entrega fora do alvo usando o contexto, com cartões acionáveis e valores em R$ (feita na tela Economia: termos da lista "sem intenção de compra", regiões e horários fora do informado, em faixa porque os recortes se sobrepõem; termos apontados pela IA ficam "a confirmar", fora da faixa; Display/PMax e perda de impressão por orçamento/ranking ficaram para depois).
Fase 4 — Dicas de palavras e campanhas: estimativa de cliques/custo/conversões usando CTR e taxa de conversão observados (estenda growth-projection.ts, com intervalo), ranking de campanhas por potencial marginal considerando perda de impressão por orçamento/ranking, cada dica com evidência, método e confiança.
Fase 5 — Auto-preenchimento amplo: estender o "Auto mágico" para negativas, rascunho de títulos/descrições (somente a partir de página e termos reais), orçamento e custo-alvo sugeridos. Tudo como "Sugerido", com aceitar/editar/descartar.
Fase 6 — Entrada manual e importação: preencher à mão ou importar CSV/planilha (custo, receita, conversões offline), mapeamento de colunas, validação, marcação `USUARIO` e efeito na confiança. Reaproveite lead-import.ts.

## Critérios de aceite
- Nenhum número exibido sem fonte, período e método; nenhum dado inventado; textos em português do Brasil.
- Com conta de poucos dados, a tela mostra o que falta e o ETA, não uma previsão.
- Parâmetros: nenhum valor sugerido sem fonte; margem/CAC/ROI nunca estimados sem dado do usuário; valor confirmado nunca sobrescrito.
- Testes cobrem: porta de suficiência, previsão e backtest, guarda numérica (rejeita número inventado e evidence_id falso), injeção de prompt em termo de busca, ausência de chave (degradação), e cálculo do "fora do alvo".
- Rodar `npm run check` (e `npm run test:api`); se tocar TypeScript compartilhado, também `npm run check:react`. Rodar `npm run sync:api` após editar api/.
- Visual conforme DESIGN-SYSTEM.md e daisyUI; classes escritas por inteiro.

Comece pela Fase 1: liste os arquivos que pretende criar/alterar e os limiares iniciais propostos, e só então implemente.
````

## 4. Decisões que mudam o escopo

1. **Provedor de LLM.** Hoje só há Anthropic. Aceitar também OpenAI/Gemini exige uma camada de provedor (ficha de fatos e guarda numérica ficam iguais). Recomendação: lançar com Anthropic e deixar a interface do provedor pronta.
2. **Limiares de suficiência.** Os números da Fase 1 são ponto de partida; calibrar com contas reais (pequenas e grandes) antes de fixar.
3. **Escopo do "fora do alvo".** Comece por termos de busca e região (dados confiáveis e já disponíveis); Display/PMax depois, porque o Google expõe menos detalhe.
