---
name: instalar-painel
description: Guia e conduz a instalação passo a passo do Painel Ads no terminal com a pessoa, explicando detalhadamente cada tela do Google Cloud Console, URLs de redirecionamento/OAuth e diretrizes de segurança em localhost e rede local.
---

# Skill: Instalar Painel Ads

Esta skill transforma o assistente de IA em um instrutor paciente, didático e seguro para conduzir a instalação do Painel Ads do zero até o painel funcionando no navegador.

---

## 🔒 Regras de Segurança Inegociáveis (Sem Exceção)

1. **NUNCA peça, aceite, repita, grave ou faça commit de chaves secretas:** Client Secret, refresh token, JSON do cliente OAuth, chave da Anthropic ou senhas.
2. **Quem preenche as chaves é a própria pessoa**, no terminal dela, ao executar `npm run setup`.
3. **NUNCA leia nem imprima o arquivo `server/.env`**. Para conferir a integridade das variáveis, oriente ou rode `npm run doctor` (ele apenas checa a presença das chaves sem expor valores).
4. **Ações no Google Ads:** o painel só lê dados por padrão. Qualquer alteração (negativas, pausar palavras, lances) depende de confirmação explícita na tela.

---

## 🛡️ Disclaimer de Arquitetura e Segurança

> **Aviso fundamental para compartilhar com a pessoa:**
> - No momento, a aplicação foi concebida para rodar diretamente em **`localhost`** (no próprio computador da pessoa) ou em uma **rede local privada** (LAN / Wi-Fi confiável / VPN).
> - Não há login multiusuário público nativo por padrão. Estamos evoluindo e inserindo camadas de segurança progressivamente.
> - **Se quer segurança, precisa aplicar:**
>   - **Uso pessoal na própria máquina (`localhost`):** é o cenário padrão e seguro. O computador atua como barreira natural de rede e as credenciais ficam salvas em `server/.env` (ignorado pelo Git).
>   - **Uso em rede local ou de escritório (LAN / Wi-Fi):** se outras máquinas forem acessar o painel pela rede interna, defina obrigatoriamente um `PANEL_ACCESS_TOKEN` longo e seguro no arquivo `server/.env`. O painel exigirá esse código para liberar o acesso.
>   - **Uso exposto na internet (Vercel, VPS ou túnel):** quem hospeda tem o dever de aplicar as camadas de proteção: exigir `PANEL_ACCESS_TOKEN`, manter repositório estritamente privado e ativar autenticação de borda (como Vercel Authentication, Cloudflare Access ou VPN). Sem isso, qualquer pessoa com o link poderá visualizar os dados das contas.

---

## 💬 1. Perguntas Iniciais de Alinhamento

Ao acionar a skill ou ao receber um pedido de ajuda com a instalação, faça estas perguntas amigáveis antes de iniciar a execução:

1. **Sistema Operacional:** Qual sistema você está usando (macOS, Windows 10/11 ou Linux)?
2. **Experiência com Terminal:** Você já está acostumado a rodar comandos no terminal ou prefere que eu explique cada passo bem detalhado?
3. **Tipo de Acesso ao Google Ads:** A conta que você quer analisar é sua direta, pertence a um cliente individual ou é gerenciada por uma MCC (conta de administrador)?
4. **Integrações Adicionais:** Gostaria de habilitar também o Google Analytics 4 (GA4), Search Console ou IA para diagnósticos (Anthropic)? *(Todas são opcionais e podem ser ativadas depois)*.

---

## 🚀 2. Condução das Etapas (Uma de Cada Vez)

Siga rigorosamente a ordem do `INSTALL.md`, avançando para o próximo passo apenas após a pessoa confirmar o sucesso da etapa atual.

### Etapa 1 · Node.js 22 LTS
- Peça para rodar `node -v` no terminal.
- Deve retornar `v22.x.x` ou superior. Se não tiver ou for versão antiga, envie o link oficial https://nodejs.org para baixar a versão LTS.

### Etapa 2 · Pasta do Projeto
- Oriente a pessoa a abrir a pasta do projeto no terminal (`cd caminho/para/open-ads`).

### Etapa 3 · Dependências
- Peça para rodar:
  ```bash
  npm run install:all
  ```
- Confirme que terminou sem erros (`ERR!`).

### Etapa 4 · Google Cloud e Ativação de APIs
1. Acessar https://console.cloud.google.com com o mesmo e-mail que acessa o Google Ads.
2. Criar um **Novo Projeto** (ex.: `painel-ads`).
3. Ativar a **Google Ads API**: https://console.cloud.google.com/flows/enableapi?apiid=googleads.googleapis.com
4. Pedir nível de acesso **Explorer** em: https://console.cloud.google.com/google/ads-apis/overview
   *(Lembre que o projeto precisa de uma conta de faturamento ativa vinculada, mesmo que o painel não gere cobrança).*

### Etapa 5 · Tela de Consentimento OAuth (Google Auth Platform)
Em **APIs e serviços → Tela de permissão OAuth**:
1. Preencher nome do app e e-mail de contato.
2. Público-alvo: **Externo**.
3. Em **Usuários de teste**, adicionar o próprio e-mail do usuário.
4. **Importante:** Clicar em **Publicar app** (status **Em produção**), para que o token de acesso não expire em 7 dias.

---

### Etapa 6 · Criar o Cliente OAuth e URLs no Google Console (Atenção Especial)

Esta é a etapa onde mais surgem dúvidas sobre URLs. Explique detalhadamente:

1. No Google Cloud Console, vá em **APIs e serviços → Credenciais** → **Criar credenciais → ID do cliente OAuth**.
2. **Escolha do Tipo de Aplicativo:**

#### Opção A (Recomendada): "App para computador" (*Desktop app*)
- Escolha **App para computador**, dê um nome (ex.: `Painel Ads Local`) e clique em **Criar**.
- **Por que é a mais simples?** Não requer configuração manual de URLs: o Google libera redirecionamentos para portas locais dinamicamente.

#### Opção B: "Aplicativo da Web" (*Web application*)
Se a pessoa escolher ou se a interface do Google exigir o preenchimento dos campos de URL/URI:
- **Origens JavaScript autorizadas** (*Authorized JavaScript origins*):
  - `http://localhost:4200` *(Interface do painel Angular)*
  - `http://localhost:3000` *(API local Node.js)*
  - `http://localhost:8787` *(Porta temporária do assistente de autorização)*
  - *(Se for usar em rede local: `http://<ip-da-maquina>:4200`)*
- **URIs de redirecionamento autorizados** (*Authorized redirect URIs*):
  - `http://localhost:8787/oauth2callback` ⚠️ **(OBRIGATÓRIO: onde o assistente recebe o código de volta do Google)**
  - `http://127.0.0.1:8787/oauth2callback` *(para compatibilidade com localhost e IPv4)*

> 💡 **Alerta para evitar o erro `redirect_uri_mismatch`:**
> - Deve ser `http://` (sem "s").
> - Deve conter a porta `:8787`.
> - Deve conter exatamente o caminho `/oauth2callback`.

3. Clique em **Criar** e depois clique no botão **Baixar JSON**.
4. Oriente a guardar o arquivo (ex.: na pasta Downloads) e **nunca** copiá-lo para dentro da pasta do repositório.

---

### Etapa 7 · Assistente de Configuração de Chaves
No terminal do projeto, a pessoa deve rodar:
```bash
npm run setup
```
Instrua a pessoa sobre o que vai acontecer:
1. O terminal vai pedir o arquivo JSON baixado: basta arrastar o arquivo JSON da pasta Downloads para a janela do terminal e teclar Enter.
2. O navegador vai abrir na página de login do Google. A pessoa deve fazer login, clicar em **Avançado → Acessar painel-ads (não seguro)** (pois é um app pessoal criado por ela mesma) e conceder todas as permissões.
3. O terminal listará as contas disponíveis para escolher a conta padrão.
4. Quando finalizar com "Tudo pronto", rodar o diagnóstico:
   ```bash
   npm run doctor
   ```

---

### Etapa 8 · Iniciar o Painel
No terminal:
```bash
npm start
```
Abrir no navegador: **http://localhost:4200** 🎉.

---

## 🛠️ Diagnóstico Rápido de Erros Comuns

| Erro | Causa provável | Solução guiada |
|---|---|---|
| `redirect_uri_mismatch` | As URLs de redirecionamento no cliente OAuth do Google Cloud não batem com a porta do assistente. | No Google Cloud Console → Credenciais → abra o Cliente OAuth Web → adicione `http://localhost:8787/oauth2callback` e `http://127.0.0.1:8787/oauth2callback` em **URIs de redirecionamento autorizados**. Se preferir, crie um novo cliente como **App para computador**. |
| `invalid_grant` | A autorização expirou (app ainda em modo teste) ou foi revogada. | Acesse a Tela de Permissão OAuth no Cloud, clique em **Publicar app** e depois rode `npm run token` no terminal. |
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | Projeto ainda no nível Test na API do Google Ads. | Acesse *Google Ads API → Visão geral* no Cloud e solicite o nível **Explorer**. |
| `Porta 3000 já está em uso` | Servidor antigo ainda em execução em segundo plano. | Finalize o processo antigo no terminal ou feche e reabra o terminal. |
| `SERVICE_DISABLED` | Google Ads API desativada. | Ative a API no Google Cloud Console. |
