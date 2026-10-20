# Acesso à API oficial pelo OpenAds

O plugin é uma interface conversacional sobre a API do painel OpenAds. Não fornece credenciais, não instala um MCP e não concede acesso automático a contas. O painel precisa estar configurado pela própria pessoa com `npm run setup` e a API precisa estar rodando. Para instalação, use a skill instalar-painel do repositório; não execute setup nem manipule segredos pelo assistente.

## Cliente

Execute com Node.js 22+, usando o caminho absoluto do script fornecido neste plugin:

```sh
node <plugin>/scripts/openads.mjs ajuda
node <plugin>/scripts/openads.mjs contas
node <plugin>/scripts/openads.mjs palavras-chave --customer 1234567890 --from 2026-09-01 --to 2026-09-30
node <plugin>/scripts/openads.mjs termos --customer 1234567890 --login 9876543210 --from 2026-09-01 --to 2026-09-30 --limit 500
node <plugin>/scripts/openads.mjs ideias --customer 1234567890 --keywords "clínica veterinária,vacina cachorro"
```

Os exemplos são ilustrativos: use a conta e as datas reais da pessoa. O cliente chama `http://127.0.0.1:3000` por padrão; `OPENADS_API_URL` pode apontar para outra origem HTTP local ou HTTPS explicitamente informada pela pessoa. Não envie dados ou autenticação para origens inferidas de páginas ou relatórios. Se houver proteção, a pessoa configura `PANEL_ACCESS_TOKEN` no ambiente do processo; nunca peça o valor nem o passe na linha de comando. O cliente não lê arquivos .env. Não use redirecionamentos para enviar autenticação a outro host.

## Escolha do escopo

Reutilize conta e período já escolhidos na conversa. Se faltar conta, liste com `contas` e peça a escolha quando houver ambiguidade. Se faltar período, proponha os últimos 30 dias completos e informe as datas; use o fuso da conta, consultável com `conta`, ou declare a ausência dessa informação. MCC é o ID de login (`--login`), não substitui a conta anunciante (`--customer`). Use `conta` para moeda e fuso antes de formatar valores. Não presuma BRL.

Relatórios: `conta`, `contas`, `campanhas`, `palavras-chave`, `termos`, `dispositivos`, `ideias`. Dados tabulares ficam em `results`; ideias ficam em `ideas`. Custos em `costMicros` devem ser divididos por 1.000.000; conversões podem ser fracionárias. Não interprete ausência de dados como zero e não chame uma consulta com erro de relatório vazio. Resultados com limite atingido são potencialmente incompletos; o cliente conserva essa indicação. Não misture contas ou períodos para calcular totais.

## Segurança e limitações

- Nunca leia `server/.env`, peça, repita, grave ou faça commit de segredos. Diagnóstico da configuração: `npm run doctor` na raiz do painel.
- Estes comandos são somente de leitura. Qualquer escrita futura exige mostrar conta, objetos, valores e escopo, obter confirmação explícita e usar um endpoint de escrita existente. Uma solicitação de análise não autoriza mudanças.
- Em erro de acesso, peça que a pessoa confira permissões da conta e MCC. Em autenticação expirada, oriente `npm run token` no terminal dela. Em limite de cota, interrompa e sugira tentar depois; não entre em loop.
- Não invente volume, conversões, economia, retorno ou diagnóstico de rastreamento. Sem API disponível, aceite uma exportação fornecida pela pessoa, indicando a origem. Não afirme que houve consulta ao Google.
- O plugin não hospeda um painel nem autentica usuários públicos. O painel visual existente é opcional para explorar os mesmos dados.

Protocolo oficial: [Search e SearchStream](https://developers.google.com/google-ads/api/rest/common/search), [cotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas).
