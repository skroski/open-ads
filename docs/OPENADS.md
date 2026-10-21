# OpenAds: comandos para a API oficial do Google Ads

O plugin em `plugins/openads/` permite pedir análises em português. O assistente escolhe o relatório e consulta a API oficial pelo servidor do painel. A pessoa não precisa escrever GAQL. O painel visual existente é uma opção adicional para explorar os dados; não precisa estar aberto para usar os comandos.

## Ativar os comandos no Claude Code

Na raiz deste repositório, abra uma sessão com o plugin local:

```sh
claude --plugin-dir ./plugins/openads
```

Para instalar de forma persistente, execute dentro do Claude Code, a partir da raiz:

```text
/plugin marketplace add .
/plugin install openads@openads
```

Reabra a sessão ou recarregue os plugins depois da instalação. O namespace `/openads:` vem do nome do plugin; uma pasta de skill isolada não registra esse namespace. Consulte a [documentação de plugins do Claude Code](https://code.claude.com/docs/en/plugins).

O pacote também inclui um manifesto `.codex-plugin/plugin.json`. A forma de descoberta e invocação depende do host; a sintaxe `/openads:...` aqui documentada corresponde ao Claude Code. O plugin ainda não foi publicado em um catálogo remoto nem instalado automaticamente no ambiente da pessoa.

## Comandos disponíveis

| Comando | Resultado |
|---|---|
| `/openads:ajuda` | Ajuda e exemplos de uso |
| `/openads:contas` | Contas disponíveis e escolha da conta |
| `/openads:visao-geral` | Resumo de investimento e resultados |
| `/openads:diagnostico-eficiencia` | Cruzamento de campanhas, termos, palavras e dispositivos para identificar contramedidas seguras |
| `/openads:oportunidades` | Oportunidades priorizadas de economia, crescimento, medição ou experimento, sempre para revisão humana |
| `/openads:analise-desperdicios` | Gastos que precisam de investigação |
| `/openads:analise-campanhas` | Comparação por campanha |
| `/openads:analise-dispositivos` | Desempenho por dispositivo |
| `/openads:analise-termos` | Buscas reais que acionaram anúncios |
| `/openads:analise-palavras-chave` | Desempenho e qualidade das palavras compradas |
| `/openads:pesquisa-palavras-chave` | Ideias do Planejador oficial |
| `/openads:auditoria-medicao` | Revisão das ações de conversão e do contexto de desempenho, sem alegar saúde de tags não consultadas |
| `/openads:auditoria-mudancas` | Linha do tempo de alterações recentes no Google Ads; disponível para até 30 dias |
| `/openads:sugestao-negativas` | Propostas de negativas para revisão |

Exemplos de pedidos:

```text
/openads:analise-palavras-chave analise setembro de 2026 da conta 1234567890
/openads:analise-termos quais buscas consumiram mais verba neste mês?
/openads:pesquisa-palavras-chave encontre ideias para clínica veterinária em Curitiba
/openads:diagnostico-eficiencia nos últimos 30 dias; minha meta de CPA é R$ 80
/openads:oportunidades onde economizar sem reduzir as conversões?
/openads:auditoria-medicao estou otimizando para as conversões certas?
/openads:auditoria-mudancas o que mudou nos últimos 14 dias?
```

Os IDs são ilustrativos. O assistente pede conta, período e mercado quando necessário. Localização e idioma do Planejador usam os identificadores oficiais do Google; o padrão do endpoint é Brasil e português. Para pesquisa local, o assistente precisa resolver e informar a localização utilizada antes de executar a consulta.

## Pré-requisito: API configurada

A autenticação é a mesma do painel. Para configurar pela primeira vez, siga a skill `instalar-painel` e [INSTALL.md](../INSTALL.md). A própria pessoa preenche as credenciais com `npm run setup`. O plugin nunca lê `server/.env`.

Com a configuração já concluída, `npm run server` inicia apenas a API local; não exige abrir o painel Angular ou React. Cada pessoa precisa ter acesso autorizado à própria conta Google Ads. O plugin não dispensa OAuth nem amplia permissões.

O cliente procura a API em `http://127.0.0.1:3000`. Quando necessário, a pessoa configura `OPENADS_API_URL` e `PANEL_ACCESS_TOKEN` no ambiente do processo. Não há argumentos de linha de comando para segredos. Não use `--env-file=server/.env` no cliente: as credenciais Google devem permanecer no servidor.

## Interface de relatórios

`POST /api/ads-report` aceita relatórios prontos. Exemplo de corpo:

```json
{
  "report": "palavras-chave",
  "customerId": "1234567890",
  "from": "2026-09-01",
  "to": "2026-09-30",
  "limit": 500
}
```

Relatórios: `conta`, `contas`, `campanhas`, `palavras-chave`, `termos`, `dispositivos`, `configuracao-conversoes` e `mudancas`. `conta`, `contas` e `configuracao-conversoes` não exigem datas. `mudancas` usa `change_event`, aceita no máximo 30 dias e só cobre alterações recentes disponíveis no Google Ads. Cabeçalhos opcionais `x-customer-id` e `x-login-customer-id` selecionam conta e MCC; têm prioridade sobre os campos correspondentes do corpo. O controle de acesso do painel continua valendo.

A resposta contém `results`, `source`, `currentCustomerId`, `period`, `costUnit`, `limit` e `possiblyTruncated`. Limites vão de 1 a 5000; quando alcançados, não trate o resultado como total completo. Para obter moeda e fuso, consulte `conta`. Custos são micros da moeda da conta. Termos de pesquisa podem ter cobertura parcial mesmo abaixo do limite, por restrições do Google.

O cliente pode ser usado diretamente, sem um assistente:

```sh
node plugins/openads/scripts/openads.mjs ajuda
node plugins/openads/scripts/openads.mjs contas
node plugins/openads/scripts/openads.mjs palavras-chave --customer 1234567890 --from 2026-09-01 --to 2026-09-30
node plugins/openads/scripts/openads.mjs diagnostico-eficiencia --customer 1234567890 --from 2026-09-01 --to 2026-09-30 --target-cpa 80
node plugins/openads/scripts/openads.mjs auditoria-mudancas --customer 1234567890 --from 2026-09-01 --to 2026-09-30
```

Ideias de palavras usam `/api/keyword-ideas`, que depende da permissão de acesso ao Planejador. Os comandos compostos `diagnostico-eficiencia`, `oportunidades` e `auditoria-medicao` reúnem relatórios de leitura para o assistente analisar; o campo `--target-cpa` fica somente no contexto retornado e não é enviado ao Google. Não há escrita por esses comandos; sugestões, pausas, negativas, lances e orçamentos precisam de revisão e confirmação explícita em outro fluxo.

## Confiabilidade e validação

`/api/search`, `/api/accounts` e `/api/ads-report` compartilham OAuth e o cliente de relatórios. Leituras têm timeout e até três tentativas para falhas temporárias de rede e HTTP 500/502/503/504. Cota e permissão interrompem a consulta. Renovações OAuth simultâneas compartilham uma única chamada; erros são apresentados sem copiar o payload do Google. Mutações não recebem repetição automática.

Referências oficiais: [Search e SearchStream](https://developers.google.com/google-ads/api/rest/common/search), [cotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas).

Os testes usam respostas simuladas, sem acessar contas reais. Execute `npm run check` para API, testes e build do Angular. Uma consulta real ainda é necessária para validar permissões da conta e compatibilidade dos relatórios no ambiente de destino.
