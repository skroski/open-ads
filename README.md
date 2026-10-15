# Painel Ads

Painel de análise de Google Ads que separa **desperdício real** de **gasto que dá resultado**. Roda no seu computador, lê suas contas pela API oficial do Google e mostra de onde vem cada número.

> Criado por **Daniel Ribeiro Skroski**. Uso e melhoria livres, com crédito obrigatório e sem revenda. Veja [Licença](#licença).

## O que ele faz

**Inteligência**
- **Visão geral:** investimento, conversões e evolução diária, com os desperdícios identificados no período.
- **Desperdícios:** classifica termos, palavras-chave, campanhas, dispositivos e horários em *Desperdício*, *Caro*, *Bom*, *Sem dados* e *Rastreamento*, com filtros por categoria e exportação em CSV. Gasto em termo que já está negativado também conta como desperdício.
- **Qualidade do funil:** cruza conversões do Google Ads com os leads e vendas que você importa (CSV).
- **Intenção e páginas:** confere se cada busca cai numa página que fala do mesmo assunto.
- **Conteúdo, Plano de ação e Histórico:** pautas, tarefas priorizadas e o efeito medido de cada mudança.

**Operação no Google Ads**
- **Termos de pesquisa** e **Palavras negativas:** cobertura de negativas entre campanhas (incluindo listas compartilhadas e grupos de anúncios) e inclusão em lote, sempre com confirmação.
- **Palavras-chave:** Índice de Qualidade, aderência à página de destino e sugestões por campanha.
- **Campanhas** e **Dispositivos e redes:** comparação com o período anterior.

**Para agências:** várias contas de clientes, acesso direto ou por MCC, e importação de todos os clientes de um MCC de uma vez. Metas, regras e histórico ficam separados por conta.

## Sumário

- [Requisitos](#requisitos)
- [Instalação com ajuda de IA (recomendado)](#instalação-com-ajuda-de-ia-recomendado)
- [Instalação manual](#instalação-manual)
- [Comandos](#comandos)
- [Contas de clientes e MCC](#contas-de-clientes-e-mcc)
- [Como foi construído](#como-foi-construído)
- [Personalizar (white label)](#personalizar)
- [Segurança](#segurança)
- [Perguntas frequentes](#perguntas-frequentes)
- [Licença](#licença)

## Requisitos

- macOS, Windows 10/11 ou Linux, com **Node.js 22 LTS** ou mais novo ([nodejs.org](https://nodejs.org))
- Uma conta Google com acesso à conta do Google Ads
- Um projeto no **Google Cloud** com a Google Ads API ativada e acesso **Explorer** ou superior. O projeto precisa de faturamento ativo (não pode ser Free Trial). O painel não gera custo no Cloud.
- Cerca de **45 minutos** na primeira instalação

## Instalação com ajuda de IA (recomendado)

O repositório traz a skill **`instalar-painel`**, que transforma o Claude Code, o Codex ou o Gemini CLI num instrutor de instalação. Ela:

1. Faz as perguntas iniciais: seu sistema, se você já usou terminal, se a conta é sua, de cliente ou de um MCC, se quer GA4, Search Console e Vercel.
2. Conduz as 8 etapas do [INSTALL.md](INSTALL.md), uma por vez, e confere cada uma antes de seguir.
3. Mostra passo a passo como criar as chaves no Google Cloud (projeto, API, tela de consentimento e cliente OAuth).
4. Explica os termos técnicos e resolve os erros mais comuns.
5. **Nunca pede chaves no chat.** Você mesmo digita tudo no seu terminal com `npm run setup`, que grava as chaves só no seu computador.

**Como usar**

1. Baixe o repositório (botão **Code → Download ZIP**) ou clone:

   ```bash
   git clone https://github.com/<seu-usuario>/<este-repositorio>.git
   cd <este-repositorio>
   ```

2. Abra a pasta na sua ferramenta e peça:

| Ferramenta | Onde a skill fica | O que digitar |
|---|---|---|
| [Claude Code](https://claude.com/claude-code) | `.claude/skills/instalar-painel/SKILL.md` (lida via `CLAUDE.md`) | `/instalar-painel` ou "instale o painel comigo" |
| [Codex](https://openai.com/codex) | `.agents/skills/instalar-painel/SKILL.md` (lida via `AGENTS.md`) | "use a skill instalar-painel e instale comigo" |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `GEMINI.md`, que aponta para a skill | "siga a skill instalar-painel e instale comigo" |

Para usar a skill em qualquer pasta do Claude Code, copie `.claude/skills/instalar-painel` para `~/.claude/skills/`.

## Instalação manual

O guia completo, com o caminho de cada clique no Google e uma tabela de erros, está no **[INSTALL.md](INSTALL.md)**. Resumo:

1. Instale o Node.js 22 LTS.
2. Na pasta do projeto, rode `npm run install:all`.
3. No [Google Cloud Console](https://console.cloud.google.com):
   - crie um projeto e ative a [Google Ads API](https://console.cloud.google.com/flows/enableapi?apiid=googleads.googleapis.com);
   - em [Google Ads API → Visão geral](https://console.cloud.google.com/google/ads-apis/overview), peça o acesso **Explorer**.
4. Na **tela de consentimento OAuth**: tipo Externo, seu e-mail como usuário de teste e **Publicar app**. Em modo teste, a autorização expira em 7 dias.
5. Em **Credenciais**, crie um **ID do cliente OAuth** do tipo **App para computador** e baixe o JSON.
6. Rode `npm run setup`, arraste o JSON para o terminal, autorize no navegador e escolha a conta.
7. Rode `npm start` e abra **http://localhost:4200**.

> Desde setembro de 2026 o Google não usa mais o "token de desenvolvedor": o nível de acesso vem do projeto do Google Cloud. Um token antigo pode ser informado no `server/.env`, mas é opcional.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run install:all` | Instala as dependências (raiz e `web/`) |
| `npm run setup` | Assistente de chaves: lê o JSON do OAuth, autoriza no navegador, grava `server/.env` e testa a conta |
| `npm start` | Sobe a API (porta 3000) e o painel (http://localhost:4200) juntos |
| `npm run doctor` | Diagnóstico de Node, dependências, chaves, portas e conexão com o Google, sem mostrar valores |
| `npm run token` | Gera de novo só o refresh token (se ele expirar ou for revogado) |
| `npm --prefix web test` / `npm run test:api` | Testes |
| `npm --prefix web run build` | Build de produção |

## Contas de clientes e MCC

Clique no nome da conta, no topo do painel, para abrir **Contas de clientes**:

- **Acesso direto:** o cliente convida o seu e-mail em *Google Ads → Administrador → Acesso e segurança*. Depois, informe o Customer ID dele.
- **Via MCC:** informe o Customer ID e o ID do MCC, ou use **Importar clientes** para trazer todos os clientes de um MCC de uma vez.
- Cada conta tem as próprias metas, regras de classificação, funil e histórico. Cadastre os **termos de marca** de cada cliente em **Configurações → Regras de classificação**, para buscas pela marca não serem tratadas como desperdício.

## Como foi construído

| Camada | Tecnologia |
|---|---|
| Interface | Angular 22 (componentes standalone, signals, signal forms) |
| Estilo | Tailwind CSS 4 + daisyUI 5, com temas claro e escuro próprios |
| Gráficos | Apache ECharts 6 (importação modular) |
| API | Funções Node.js em `api/`: as mesmas rodam localmente (`server/index.mjs`) e na Vercel |
| Dados | Google Ads API v25 (GAQL); opcionais: GA4 Data API, Search Console API e Anthropic |
| Armazenamento | Navegador (localStorage + IndexedDB), por conta. Nenhum banco de dados externo. |

Estrutura:

```
api/                 funções da API (edite aqui e rode npm run sync:api)
server/              servidor local, fluxo OAuth e leitura do .env
scripts/             setup, doctor, start e geração do pacote
web/src/app/
  brand.ts           nome, logo em texto e termos de marca (white label)
  core/              estado: conta ativa, dados, insights
  domain/            regras de negócio puras, com testes (*.spec.ts)
  data/              consultas GAQL e normalização
  features/          telas
  shared/            componentes do design system
web/src/styles.css   temas, tokens de espaço e tipografia
```

Testes: `npm --prefix web test` (painel) e `npm run test:api` (API).

## Personalizar

- **Sua marca:** edite `web/src/app/brand.ts`.
- **Seu design system:** veja **[DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)**.
- **Termos de marca de cada cliente:** no painel, em **Configurações → Regras de classificação**.

Limitações conhecidas: valores em reais (BRL) e textos em português; o Planejador de Palavras-chave exige acesso Basic na API.

## Segurança

- As chaves ficam só em `server/.env`, que está no `.gitignore`.
- O painel lê dados. Só altera o Google Ads (negativas, pausar ou ajustar lances de palavras-chave) quando você clica e confirma.
- **Não há login.** Se publicar na internet, ative a proteção de acesso da hospedagem (veja INSTALL.md).

## Perguntas frequentes

**Preciso pagar alguma coisa?** O painel é gratuito. O Google Cloud exige faturamento ativo para liberar contas reais na API, mas o uso do painel não gera cobrança lá. A explicação por IA (opcional) usa uma chave da Anthropic, paga por uso.

**Meus dados vão para algum servidor?** Não. O painel roda no seu computador e conversa direto com o Google. Configurações e histórico ficam no seu navegador.

**O painel mexe nas minhas campanhas?** Só quando você clica e confirma uma ação (adicionar negativas, pausar ou ajustar lance de palavra-chave). O resto é leitura.

**Funcionou ontem e hoje deu `invalid_grant`.** O app OAuth está em modo teste e a autorização expirou (7 dias). Publique o app na tela de consentimento e rode `npm run token`.

**Aparece `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`.** O projeto do Google Cloud ainda está no acesso Test. Peça o acesso Explorer em *Google Ads API → Visão geral*.

**Posso colocar na internet?** Pode, na Vercel (veja o INSTALL.md), mas o painel não tem login. Ative a proteção de acesso da Vercel antes de compartilhar o endereço.

**Posso usar com a minha marca?** Sim: troque nome, logo em texto e cores (veja [Personalizar](#personalizar)). Mantenha o crédito ao autor, como pede a licença.

## Licença

Código-fonte disponível sob **Apache License 2.0 com a condição Commons Clause**. Veja [LICENSE](LICENSE) e [NOTICE](NOTICE).

- ✅ Pode usar, estudar, modificar e melhorar.
- ✅ Pode redistribuir, mantendo `LICENSE`, `NOTICE` e o crédito ao autor (inclusive o "Criado por" na interface).
- ❌ Não pode vender o software, nem oferecer a terceiros, mediante pagamento, um produto ou serviço cujo valor venha total ou substancialmente dele. Isso inclui cobrar por hospedagem, consultoria ou suporte relacionados ao software.

Em caso de dúvida, vale o texto do [LICENSE](LICENSE).

Como a Commons Clause restringe a venda, este projeto é **source-available**, e não "open source" no sentido da OSI. Para outro tipo de uso comercial, fale com o autor.

Bibliotecas de terceiros mantêm as próprias licenças (Angular e daisyUI: MIT; ECharts: Apache 2.0; fontes Google Fonts: OFL).
