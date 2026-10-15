# Instalação passo a passo

Este guia leva você do zero até o painel rodando no seu computador, mesmo sem experiência com programação.

> **Leia antes de começar**
> - Reserve de **45 a 60 minutos** e siga **todas** as etapas, na ordem. Se pular uma, as próximas falham.
> - Você vai criar chaves de acesso no Google. **Elas são como senhas.** Nunca cole esses valores em chats (nem com IA), e-mails, prints ou no GitHub. O assistente `npm run setup` grava tudo direto num arquivo do seu computador.
> - Se estiver usando uma IA (Claude, Codex ou Gemini) para ajudar, peça: *"siga o INSTALL.md comigo"*. Ela orienta e roda os comandos, mas **quem digita as chaves é você**, no seu terminal.

**Do que você precisa**

| Item | Para quê |
|---|---|
| Computador com macOS, Windows 10/11 ou Linux | Rodar o painel |
| Uma conta Google com acesso à conta do Google Ads | Autorizar a leitura dos dados |
| Acesso ao Google Cloud com a mesma conta (gratuito) | Criar o "aplicativo" que conversa com a API |
| Uma conta de faturamento ativa no Google Cloud (não pode ser Free Trial) | O Google exige isso para liberar contas reais. O painel não gera custo no Cloud. |

---

## Etapa 1 · Instalar o Node.js

O Node.js é o "motor" que roda o painel.

1. Acesse **https://nodejs.org** e baixe a versão **LTS** (22 ou mais nova).
2. Instale com as opções padrão (Avançar, Avançar, Concluir).
3. Abra o terminal:
   - **macOS:** aperte `Cmd + Espaço`, digite **Terminal** e tecle Enter.
   - **Windows:** menu Iniciar → digite **PowerShell** → abrir.
4. Digite e tecle Enter:

   ```bash
   node -v
   ```

   ✅ Deve aparecer algo como `v22.x.x`. Se aparecer "comando não encontrado", feche e abra o terminal de novo ou reinicie o computador.

## Etapa 2 · Baixar o projeto

**Opção A, pelo zip:** descompacte o arquivo numa pasta fácil de achar (ex.: `Documentos/painel-ads`).

**Opção B, pelo GitHub:** crie um repositório novo e envie o conteúdo do zip, ou rode `git clone <url-do-seu-repositório>`.

No terminal, entre na pasta do projeto. Dica: digite `cd ` (com espaço), arraste a pasta para a janela do terminal e tecle Enter.

```bash
cd caminho/da/pasta/painel-ads
```

## Etapa 3 · Instalar as dependências

```bash
npm run install:all
```

Leva de 1 a 3 minutos. ✅ Termina sem a palavra `ERR!`. Avisos (`WARN`) podem ser ignorados.

---

## Etapa 4 · Criar o projeto no Google Cloud

1. Acesse **https://console.cloud.google.com** com a conta Google que acessa o Google Ads.
2. No topo, clique no seletor de projetos → **Novo projeto** → dê um nome (ex.: `painel-ads`) → **Criar**. Confira se o projeto novo ficou selecionado no topo.
3. **Ative a Google Ads API:** abra https://console.cloud.google.com/flows/enableapi?apiid=googleads.googleapis.com e clique em **Ativar**.
4. *(Opcional, para as telas de conteúdo)* Ative também a **Google Analytics Data API** e a **Google Search Console API** em **APIs e serviços → Biblioteca**.
5. **Verifique o nível de acesso:** abra https://console.cloud.google.com/google/ads-apis/overview
   - Se aparecer **Test**, expanda **Upgrade access level** e peça o acesso **Explorer**. Normalmente a aprovação é automática.
   - O pedido costuma ser recusado se o projeto estiver em **Free Trial** ou com faturamento suspenso. Vincule uma conta de faturamento ativa em **Faturamento**.
   - O nível **Basic** (necessário só para o Planejador de Palavras-chave) exige verificação da marca no Google Cloud. O painel funciona sem ele.

> Desde setembro de 2026 o Google **não usa mais o "token de desenvolvedor"** da Central de API: o acesso vem do projeto do Google Cloud. Se você já tem um token antigo, pode informá-lo no `server/.env`; ele é opcional.

## Etapa 5 · Configurar a tela de consentimento (Google Auth Platform)

No menu do Cloud, vá em **APIs e serviços → Tela de permissão OAuth** (ou **Google Auth Platform**).

1. **Branding / Informações do app:** nome do app (ex.: `Painel Ads`), seu e-mail de suporte e e-mail de contato → **Salvar**.
2. **Público-alvo / Audience:** tipo **Externo**.
3. Em **Usuários de teste**, adicione o seu próprio e-mail.
4. **Importante:** clique em **Publicar app** (status **Em produção**).
   - Enquanto o app está "Em teste", a autorização **expira a cada 7 dias**, e o painel para de funcionar até você refazer o passo da Etapa 7.
   - Publicar não deixa nada público: só quem tem o arquivo de credenciais consegue usar. O Google vai mostrar o aviso "app não verificado", e isso é esperado num app pessoal.

## Etapa 6 · Criar o cliente OAuth e baixar o arquivo

1. Vá em **Clientes** (ou **APIs e serviços → Credenciais**) → **Criar cliente** / **Criar credenciais → ID do cliente OAuth**.
2. Tipo de aplicativo: **App para computador** (*Desktop app*). Nome: qualquer um.
3. Clique em **Criar** e depois em **Baixar JSON**.
4. Guarde o arquivo (ex.: na pasta Downloads). **Não envie esse arquivo para ninguém** e não o coloque dentro da pasta do projeto.

## Etapa 7 · Rodar o assistente de chaves

No terminal, dentro da pasta do projeto:

```bash
npm run setup
```

O assistente:

1. Pede o arquivo JSON da Etapa 6. **Arraste o arquivo para a janela do terminal** e tecle Enter.
2. Abre o navegador para você entrar com a conta Google que acessa o Google Ads.
   - Se aparecer **"O Google não verificou este app"**, clique em **Avançado → Acessar painel-ads (não seguro)**. É o seu próprio app.
   - Marque **todas** as caixas de permissão.
3. Lista as contas do Google Ads que esse login enxerga. Escolha a conta padrão pelo número.
4. Pergunta itens opcionais (domínios do site, chave de IA). Tecle Enter para pular.

✅ Termina com **"Tudo pronto"**. As chaves ficam em `server/.env`, que nunca vai para o Git.

Para conferir tudo depois, rode:

```bash
npm run doctor
```

## Etapa 8 · Abrir o painel

```bash
npm start
```

Quando aparecer `Local: http://localhost:4200`, abra **http://localhost:4200** no navegador. 🎉

- Para parar, volte ao terminal e aperte `Ctrl + C`.
- Para abrir de novo outro dia: entre na pasta, rode `npm start` e abra o mesmo endereço.

---

## Adicionar contas de clientes

No topo do painel, clique no nome da conta para abrir **Contas de clientes**.

- **Cliente com acesso direto:** o cliente convida o seu e-mail em *Google Ads → Administrador → Acesso e segurança*. Depois, informe o **Customer ID** dele (10 dígitos, no canto superior direito do Google Ads).
- **Cliente gerenciado por um MCC (conta de administrador):** vincule a conta do cliente ao seu MCC. No painel, informe o Customer ID e o **ID do MCC**, ou use **Importar clientes de um MCC** para trazer todos de uma vez.
- Cada conta guarda as próprias metas, regras, mapeamento do funil e histórico neste navegador. Use **Configurações → Backup** para levar a configuração para outro computador.
- Cadastre os **termos de marca** de cada cliente em **Configurações → Regras de classificação**, para buscas pela marca não serem tratadas como desperdício.

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| `invalid_grant` | A autorização expirou (app "Em teste") ou foi revogada. Publique o app (Etapa 5) e rode `npm run token`. |
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | O projeto está no acesso Test. Peça o acesso Explorer (Etapa 4, item 5). |
| `USER_PERMISSION_DENIED` | Seu login não acessa essa conta. Peça acesso ao cliente ou informe o ID do MCC. |
| `SERVICE_DISABLED` | A Google Ads API não foi ativada no projeto (Etapa 4, item 3). |
| `redirect_uri_mismatch` | O cliente OAuth não é do tipo "App para computador". Crie outro (Etapa 6). |
| `Porta 3000 já está em uso` | Outro painel já está aberto. Feche o terminal antigo ou reinicie o computador. |
| Tela em branco ou "Rota não encontrada" | Rode `npm start` (e não só `npm run web`), para a API subir junto. |
| Planejador de Palavras-chave indisponível | Exige o acesso Basic (Etapa 4). O resto do painel funciona normalmente. |

## Publicar na internet (opcional, Vercel)

O painel foi feito para rodar **no seu computador**. Se publicar na Vercel:

> ⚠️ **Não há tela de login.** Qualquer pessoa com o endereço consegue ver os dados das contas e **adicionar palavras negativas**. Ative a proteção da Vercel (**Settings → Deployment Protection → Vercel Authentication**) antes de compartilhar o link.

1. Envie o projeto para um repositório **privado** no GitHub.
2. Na Vercel, importe o repositório. As configurações de build já estão em `vercel.json`.
3. Em **Settings → Environment Variables**, cadastre as mesmas variáveis do seu `server/.env` (abra o arquivo no seu editor e copie uma a uma).
4. Faça o deploy.

## Segurança

- `server/.env` fica fora do Git (`.gitignore`). Confira antes de cada envio com `git status`.
- O painel só lê dados, com uma exceção: ele adiciona palavras negativas e pausa ou ajusta palavras-chave quando **você** clica e confirma.
- Para revogar o acesso a qualquer momento: https://myaccount.google.com/permissions.
