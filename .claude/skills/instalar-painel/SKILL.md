---
name: instalar-painel
description: Guia e conduz a instalação e o desenvolvimento do Painel Ads com a pessoa, passo a passo, em duas opções de stack - Angular (versão Oficial) ou React com Vite (versão alternativa compatível). Identifica a stack antes de agir, nunca mistura as duas, e explica cada tela do Google Cloud Console, URLs de redirecionamento/OAuth e diretrizes de segurança em localhost e rede local.
---

# Skill: Instalar Painel Ads

Esta skill transforma o assistente de IA em um instrutor paciente, didático e seguro para conduzir a instalação do Painel Ads do zero até o painel funcionando no navegador, e para orientar o desenvolvimento nas duas stacks suportadas.

> **Esta Skill possui uma versão Oficial em Angular e uma versão compatível em React. A versão React utiliza Vite, TypeScript, Tailwind CSS e DaisyUI, mantendo o mesmo padrão visual e reaproveitando a maior quantidade possível de código TypeScript.**

Leia este arquivo inteiro antes de agir. A parte específica de React (estrutura, código compartilhado, DaisyUI, testes) está detalhada em [`react.md`](react.md), na mesma pasta.

---

## 🔒 Regras de Segurança Inegociáveis (Sem Exceção)

1. **NUNCA peça, aceite, repita, grave ou faça commit de chaves secretas:** Client Secret, refresh token, JSON do cliente OAuth, chave da Anthropic ou senhas.
2. **Quem preenche as chaves é a própria pessoa**, no terminal dela, ao executar `npm run setup`.
3. **NUNCA leia nem imprima o arquivo `server/.env`**. Para conferir a integridade das variáveis, oriente ou rode `npm run doctor` (ele apenas checa a presença das chaves sem expor valores).
4. **Ações no Google Ads:** o painel só lê dados por padrão. Qualquer alteração (negativas, pausar palavras, lances) depende de confirmação explícita na tela.

Estas regras valem igualmente para Angular e React. A API (`api/`, `server/`) e o `server/.env` são **os mesmos** nas duas stacks.

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

## 🧭 0. Escolha da Stack: Angular (Oficial) ou React com Vite

**Antes de iniciar qualquer instalação, implementação ou configuração**, apresente as duas opções à pessoa:

| Opção | Papel | Tecnologias |
|---|---|---|
| **Angular** | **Versão Oficial** do projeto. É a referência de comportamento, layout e regras. | Angular 22, Tailwind CSS 4, daisyUI 5, ECharts 6 (pasta `web/`) |
| **React** | **Versão alternativa compatível**, independente, de primeira classe. | React, Vite, TypeScript, Tailwind CSS 4, daisyUI 5, ECharts 6 |

Diga isto com estas palavras (ou muito próximas): *"Esta Skill possui uma versão Oficial em Angular e uma versão compatível em React. A versão React utiliza Vite, TypeScript, Tailwind CSS e DaisyUI, mantendo o mesmo padrão visual e reaproveitando a maior quantidade possível de código TypeScript."*

### Regras de decisão

1. **Se a pessoa já disse a stack** ("quero em React", "versão oficial", "Angular"): confirme em uma frase e siga.
2. **Se a preferência não está clara**, pergunte exatamente: **"Você deseja instalar a versão Oficial em Angular ou a versão React com Vite?"** e **espere a resposta**. Não escolha por ela e não assuma a mais popular.
3. **Se ela só quer o painel funcionando e não tem preferência técnica:** explique que Angular é a versão Oficial e já está completa neste repositório; recomende Angular e deixe a decisão com ela.
4. **Anote a escolha** e use-a em todas as etapas seguintes. Se a pessoa trocar de ideia depois, volte à §0 e refaça a detecção.

### Posicionamento (não desvirtue)

- **Angular continua sendo a versão Oficial.** Nunca remova, substitua, despriorize ou "migre" o Angular.
- **React não é uma migração do Angular.** É uma implementação independente e compatível do mesmo projeto. Nunca use a palavra "migrar" para descrevê-la e nunca altere `web/` para "preparar" o React sem pedido explícito.
- **O produto é um só:** mesmos nomes, fluxos, comportamentos, layout e identidade visual nas duas stacks. A arquitetura interna do React pode ser diferente; a experiência visual, não.

### Detecção automática da stack do projeto (antes de sugerir qualquer alteração)

Rode estas verificações na raiz do repositório (somente leitura) e **nunca leia `server/.env`**:

```bash
# Angular Oficial: pasta web/ com angular.json e @angular/core
test -f web/angular.json && grep -q '"@angular/core"' web/package.json && echo "Angular Oficial presente em web/"

# React/Vite: package.json (fora de node_modules) com react + vite, dentro do repositório
# OU em pasta irmã (ex.: ../openads-react)
for f in $(find . .. -maxdepth 3 -name package.json -not -path '*/node_modules/*' 2>/dev/null); do
  grep -q '"react"' "$f" && grep -q '"vite"' "$f" && echo "React/Vite em: $(dirname "$f")"
done
```

Interprete assim:

| Resultado | Conclusão |
|---|---|
| Só Angular (`web/`) | Projeto **Angular** sem a base React (cópia antiga ou pasta removida). Se a pessoa quer React, escolha o local (veja abaixo) e siga `react.md` §1, sem tocar em `web/`. |
| Só React/Vite | Projeto **React**. Siga somente o caminho React. |
| Os dois | Pergunte **em qual** a pessoa está trabalhando agora e trabalhe só nela. |
| Nenhum | Não é a raiz do repositório. Peça para abrir a pasta correta (Etapa 2). |

Sinais de cada stack em um arquivo: `*.component.ts`, `@Component`, `@Injectable`, `signal(`, `inject(`, `@if`/`@for`, `app.config.ts` → **Angular**. `*.tsx`, `useState`, `useEffect`, `createRoot`, `vite.config.ts`, `className=` → **React**.

### Onde fica a pasta React (a pessoa escolhe)

**O repositório já inclui a base React em `web-react/` (Opção A)**: Vite, TypeScript, Tailwind 4, daisyUI 5, ECharts, tema e menu idênticos ao Angular, proxy `/api`, e o TypeScript do `domain/` compartilhado por alias. **Estado real:** shell completo (menu, tema claro/escuro, conta e período), camada de dados e a tela **Visão geral** portadas, com os mesmos números do Angular; as demais telas ainda são marcadores "não portada" e **não exibem dados**. Nunca diga que o React "tem todas as telas". Porte as telas só quando a pessoa pedir (veja `react.md` §7).

Se a pessoa quer o React em outro lugar, ou a pasta não existe, **pergunte onde ela prefere**. As duas opções são válidas e não exigem monorepo:

| Opção | Local | Quando escolher |
|---|---|---|
| **A · Dentro do repositório** | `open-ads/web-react/` | Quer tudo num lugar só, um único Git e um único `clone`. |
| **B · Pasta irmã** | `../openads-react/` (ao lado de `open-ads/`) | Quer o React como projeto/repositório separado, sem sujar o Oficial. Ótimo para testar os dois lado a lado. |

Os nomes de pasta são sugestões: a pessoa pode usar outros. **Anote a escolha** e use estas variáveis em todos os comandos:

| Variável | Opção A | Opção B |
|---|---|---|
| `<pasta-react>` (a partir da raiz do `open-ads`, para usar com `npm --prefix`) | `web-react` | `../openads-react` |
| `<caminho-shared>` (da pasta React até `web/src/app`, para o alias `@shared`) | `../web/src/app` | `../open-ads/web/src/app` *(use o nome real da pasta do repositório)* |
| Git | o mesmo do `open-ads` | repositório próprio (ou nenhum) |

Em ambas: **a API e o `server/.env` continuam só no `open-ads`** (nunca copie o `.env` para a pasta React), e o código compartilhado continua em `web/src/app` (nada é copiado). Na Opção B, o `open-ads` precisa estar instalado (`npm run install:all`) e a pasta irmã deve ficar no mesmo nível dele, para o alias e o `server.fs.allow` funcionarem.

**Porta do painel React:** use **4200** por padrão (as origens do OAuth não mudam). Para **rodar Angular e React ao mesmo tempo** (comparação lado a lado), use **4201** no React; se o cliente OAuth for "Aplicativo da Web", acrescente `http://localhost:4201` às origens autorizadas (Etapa 6). Com "App para computador" não precisa mudar nada no Google.

### Regras para evitar mistura acidental

- **Nunca aplique instruções Angular em um projeto React** (`ng serve`, `ng test`, `@Component`, `inject()`, `@if`, `app.config.ts`, `angular.json`) **nem instruções React em um projeto Angular** (hooks, JSX/TSX, `vite.config.ts`, `className`).
- **Não instale pacotes de uma stack na outra.** `react`, `react-dom` e `vite` nunca entram em `web/package.json`; `@angular/*` nunca entra no `package.json` da pasta React.
- **Cada stack tem a própria pasta e o próprio `package.json`.** Rode comandos a partir da raiz do `open-ads` com `--prefix` explícito (`npm --prefix web ...` ou `npm --prefix <pasta-react> ...`), ou abra o terminal já dentro da pasta da stack; nunca troque de pasta sem avisar.
- **Antes de cada edição ou comando de desenvolvimento, confirme em qual pasta está.** Se um arquivo pedido pertencer à outra stack, pare e avise.
- **Código compartilhado (puro TypeScript) não pode importar `@angular/*` nem `react`.** Veja §3.

---

## 💬 1. Perguntas Iniciais de Alinhamento

Ao acionar a skill ou ao receber um pedido de ajuda com a instalação, faça estas perguntas amigáveis antes de iniciar a execução:

1. **Stack:** (veja §0) *"Você deseja instalar a versão Oficial em Angular ou a versão React com Vite?"*
2. **Sistema Operacional:** Qual sistema você está usando (macOS, Windows 10/11 ou Linux)?
3. **Experiência com Terminal:** Você já está acostumado a rodar comandos no terminal ou prefere que eu explique cada passo bem detalhado?
4. **Tipo de Acesso ao Google Ads:** A conta que você quer analisar é sua direta, pertence a um cliente individual ou é gerenciada por uma MCC (conta de administrador)?
5. **Integrações Adicionais:** Gostaria de habilitar também o Google Analytics 4 (GA4), Search Console ou IA para diagnósticos (Anthropic)? *(Todas são opcionais e podem ser ativadas depois)*.

---

## 🚀 2. Condução das Etapas (Uma de Cada Vez)

Siga rigorosamente a ordem do `INSTALL.md`, avançando para o próximo passo apenas após a pessoa confirmar o sucesso da etapa atual. As etapas 1, 2 e 4 a 7 são **idênticas nas duas stacks**; só as Etapas 3 e 8 mudam.

### Etapa 1 · Node.js 22 LTS
- Peça para rodar `node -v` no terminal.
- Deve retornar `v22.x.x` ou superior. Se não tiver ou for versão antiga, envie o link oficial https://nodejs.org para baixar a versão LTS.

### Etapa 2 · Pasta do Projeto
- Oriente a pessoa a abrir a pasta do projeto no terminal (`cd caminho/para/open-ads`).

### Etapa 3 · Dependências

**Angular (Oficial):**
```bash
npm run install:all
```
Instala a raiz e `web/` (Angular). Confirme que terminou sem erros (`ERR!`).

**React com Vite:**
```bash
npm run install:all                  # raiz + web/ (onde fica o TypeScript compartilhado e a versão Oficial)
npm run install:react                # dependências de web-react/ (Opção A, já incluída)
# Opção B (pasta irmã): npm --prefix ../openads-react install
```
Mantenha `web/` instalada mesmo na stack React: o código compartilhado mora lá (§3) e o `npm run doctor` confere `web/node_modules`. Se a pasta React ainda não existe, pergunte onde criá-la (Opção A ou B, §0) e crie-a conforme `react.md` §1 **antes** deste comando. Confirme que terminou sem erros (`ERR!`).

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
- **Vale igual para Angular e React:** o OAuth é feito pelo `npm run setup` (porta 8787), que não depende da interface.

#### Opção B: "Aplicativo da Web" (*Web application*)
Se a pessoa escolher ou se a interface do Google exigir o preenchimento dos campos de URL/URI:
- **Origens JavaScript autorizadas** (*Authorized JavaScript origins*):
  - `http://localhost:4200` *(Interface do painel, Angular **ou** React/Vite: a versão React usa a mesma porta 4200, então a origem não muda)*
  - `http://localhost:3000` *(API local Node.js)*
  - `http://localhost:8787` *(Porta temporária do assistente de autorização)*
  - *(Se for usar em rede local: `http://<ip-da-maquina>:4200`)*
  - *(Somente se a pessoa rodar o React em outra porta, por exemplo 4201 para ver Angular e React lado a lado: acrescente também `http://localhost:4201`)*
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

**Angular (Oficial):**
```bash
npm start
```
Sobe API (:3000) e painel Angular (:4200) juntos. Abrir no navegador: **http://localhost:4200** 🎉.

**React com Vite (`web-react/`, Opção A):**
```bash
npm run start:react
```
Sobe API (:3000) e painel React (:4200) juntos, como o `npm start` faz com o Angular.

Se a pasta React está em outro lugar (Opção B), o `npm start` e o `start:react` não a conhecem: use dois terminais:
```bash
# terminal 1: API local (lê server/.env)
npm run server

# terminal 2: painel React (Vite)
npm --prefix <pasta-react> run dev
```
Abrir no navegador: **http://localhost:4200** 🎉 (a pasta React configura a porta e o proxy `/api` → `http://127.0.0.1:3000`; veja `react.md` §3). Na **mesma porta**, não rode Angular e React juntos: pare um antes de subir o outro. Para vê-los **lado a lado**, deixe o Angular em 4200 e o React em **4201** (http://localhost:4201), com uma única API.

---

## 🧩 3. Organização do Projeto e Reaproveitamento de TypeScript

O objetivo é que as duas stacks compartilhem a **mesma** lógica, sem duplicar regra de negócio. Ao orientar qualquer desenvolvimento, separe o código assim:

| Camada | Conteúdo | Pode importar |
|---|---|---|
| **Compartilhado (TypeScript puro)** | tipos, interfaces, enums, modelos, validações, utilitários, regras de negócio, cálculos, contratos de API, constantes, estruturas de configuração, schemas, adaptadores/normalizadores, testes `*.spec.ts` | só TypeScript e bibliotecas neutras (ex.: `echarts`) |
| **Específico de Angular** | componentes, serviços `@Injectable`, `signal`/`resource`, `HttpClient`, interceptors, rotas, `app.config.ts` | `@angular/*` |
| **Específico de React** | componentes TSX, hooks, contexto/estado, cliente HTTP (`fetch`), rotas, `vite.config.ts` | `react`, `react-dom` |

**Regras de reaproveitamento:**

1. **Reutilize antes de escrever.** Para qualquer funcionalidade, procure primeiro o código compartilhável e importe-o. Não reescreva regras de negócio na camada React.
2. **Já é compartilhável hoje** (verificado: não importam `@angular/*`): `web/src/app/domain/` (regras, cálculos, classificação, funil, negativas, recomendações, rastreamento…), `web/src/app/brand.ts`, `web/src/app/data/ads-normalize.ts` e `web/src/app/data/ads-queries.ts`, com seus `*.spec.ts`. **Reconfira com `grep -rn "@angular" <arquivo>` antes de assumir** em arquivos novos.
3. **Depende de Angular hoje:** `web/src/app/core/` (stores, serviços, interceptors, `resource`) e `web/src/app/data/google-ads.api.ts` / `integrations.api.ts` (`HttpClient`). Quando o React precisar de uma dessas lógicas, **separe a regra do framework**: extraia a parte pura (funções, tipos, montagem de requisições) para o código compartilhado e deixe em cada stack só a "cola" (signals/`HttpClient` no Angular; hooks/`fetch` no React).
4. **Sem mexer no Oficial sem autorização.** A extração para código compartilhado em `web/` só acontece com pedido explícito da pessoa, em mudanças pequenas, com os testes do Angular passando antes e depois (`npm --prefix web test -- --watch=false` e `npm --prefix web run build`). Nunca mova ou renomeie arquivos do Angular "de passagem".
5. **Como o React enxerga o código compartilhado, sem copiar:** por alias de caminho (`@shared/*` apontando para `<caminho-shared>/...`, ou seja, `../web/src/app/...` na Opção A e `../open-ads/web/src/app/...` na Opção B) configurado em `tsconfig` e `vite.config.ts` da pasta React. Detalhes em `react.md` §2. Se um dia o time optar por uma pasta `shared/` na raiz, é uma decisão da pessoa, não da skill.
6. **Duplicação só como último recurso**, registrada com um comentário apontando a fonte original.

Estrutura-alvo (conceitual; os nomes de pastas React são sugestão). **Opção A**, React dentro do repositório:

```
open-ads/
├── api/  server/  scripts/            # compartilhados: API e ferramentas (iguais nas duas stacks)
├── web/                               # Angular Oficial
│   └── src/app/
│       ├── domain/  data/ads-*.ts  brand.ts   # ← TypeScript compartilhado (puro)
│       ├── core/  data/*.api.ts  features/  shared/   # ← específico de Angular
│       └── app.config.ts  app.routes.ts       # ← configuração Angular
└── web-react/                         # React + Vite (independente)
    ├── vite.config.ts  tsconfig*.json         # ← configuração React/Vite (alias @shared → ../web/src/app)
    └── src/ (components/ hooks/ pages/ api/ …)  # ← específico de React
```

**Opção B**, React em pasta irmã (sem monorepo): a mesma estrutura do `open-ads/` acima, mais:

```
Documents/
├── open-ads/                          # Angular Oficial + API + server/.env (como acima)
└── openads-react/                     # React + Vite (independente, projeto próprio)
    ├── vite.config.ts  tsconfig*.json         # ← alias @shared → ../open-ads/web/src/app
    └── src/ (components/ hooks/ pages/ api/ …)
```

---

## 🎨 4. Layout, DaisyUI e Identidade Visual

- **O layout, os componentes e a identidade são os mesmos** nas duas stacks. A referência é a versão Angular + `DESIGN-SYSTEM.md`.
- **Use DaisyUI tanto quanto possível no React**, com as mesmas classes (`btn`, `card`, `stat`, `table`, `badge`, `modal`, `menu`, `alert`, `tabs`…), os mesmos temas claro/escuro e os mesmos tokens. Consulte a skill `daisyui` (`.agents/skills/daisyui`).
- **Não crie um novo Design System para o React** e **não substitua o DaisyUI por shadcn/ui, MUI, Chakra ou outra biblioteca visual sem autorização explícita** da pessoa. Se ela pedir, confirme uma vez que entende que isso quebra a equivalência visual com o Oficial.
- **Reaproveite os temas e tokens** de `web/src/styles.css` (`@plugin "daisyui/theme"`, `@theme`, `@utility`). Prefira importar/compartilhar o mesmo CSS; se precisar copiar, copie sem alterar valores e anote a origem. Veja `react.md` §4.
- **Escreva as classes por inteiro**, nunca montadas em tempo de execução (o Tailwind precisa enxergá-las no código). Isso vale em JSX e em templates Angular.
- Textos da interface em português do Brasil; todo número exibido deve indicar a fonte; sem dados inventados. Marca e textos de exemplo ficam em `brand.ts`, não espalhados.
- **Não altere a experiência visual sem pedido.** A arquitetura interna do React pode ser diferente; o resultado na tela, não.

---

## ✅ 5. Critérios de Validação

Só declare a instalação ou a mudança concluída quando todos os itens da stack escolhida passarem. Rode os comandos e mostre o resultado à pessoa.

### Comuns às duas stacks
- [ ] `node -v` ≥ 22.
- [ ] `npm run doctor` sem problemas (só mostra nomes das variáveis, nunca valores).
- [ ] `npm run check:api` e `npm run test:api` passam (a API é compartilhada; se editou `api/`, rode `npm run sync:api` antes).
- [ ] Nenhuma chave, `.env` ou JSON de cliente OAuth no `git status`.
- [ ] Painel abre em **http://localhost:4200** e carrega dados da conta (não só a tela vazia).
- [ ] Textos em português do Brasil e números com fonte indicada.

### Angular (Oficial)
- [ ] `npm run install:all` sem `ERR!`.
- [ ] `npm --prefix web test -- --watch=false` passa.
- [ ] `npm --prefix web run build` passa.
- [ ] `npm start` sobe API (:3000) e painel (:4200).
- [ ] `git status` não mostra arquivos de React/Vite dentro de `web/`.

### React com Vite
- [ ] Pasta React tem `package.json` com `react`, `react-dom`, `vite`, `typescript`, `tailwindcss`, `daisyui` e **nenhum** `@angular/*`.
- [ ] `npm --prefix <pasta-react> run build` passa (`tsc` + `vite build`), com TypeScript sem `any` implícito.
- [ ] `npm --prefix <pasta-react> test` passa, incluindo os `*.spec.ts` compartilhados de `domain/` rodando no Vitest do React.
- [ ] `npm run check:react` passa (Opção A: testes + build). `npm run start:react` sobe API e painel; `/api/...` responde pelo proxy do Vite. Opção B: `npm run server` + `npm --prefix <pasta-react> run dev`.
- [ ] Opção B: a pasta irmã **não** contém `server/.env` nem cópia de `api/`; só o `open-ads` os tem.
- [ ] **Equivalência visual:** mesmas telas, mesmos temas (claro/escuro), mesmas classes DaisyUI. Compare lado a lado com o Angular na mesma conta e período.
- [ ] Nenhuma regra de negócio duplicada: `grep` pelos nomes das funções de `domain/` não acha cópias na pasta React.
- [ ] **O Angular continua intacto:** `npm --prefix web test -- --watch=false` e `npm --prefix web run build` ainda passam, e `git diff` não mostra mudanças em `web/` além das autorizadas.

---

## 🛠️ 6. Diagnóstico Rápido de Erros Comuns

### Comuns (Google / API / ambiente)

| Erro | Causa provável | Solução guiada |
|---|---|---|
| `redirect_uri_mismatch` | As URLs de redirecionamento no cliente OAuth do Google Cloud não batem com a porta do assistente. | No Google Cloud Console → Credenciais → abra o Cliente OAuth Web → adicione `http://localhost:8787/oauth2callback` e `http://127.0.0.1:8787/oauth2callback` em **URIs de redirecionamento autorizados**. Se preferir, crie um novo cliente como **App para computador**. |
| `invalid_grant` | A autorização expirou (app ainda em modo teste) ou foi revogada. | Acesse a Tela de Permissão OAuth no Cloud, clique em **Publicar app** e depois rode `npm run token` no terminal. |
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | Projeto ainda no nível Test na API do Google Ads. | Acesse *Google Ads API → Visão geral* no Cloud e solicite o nível **Explorer**. |
| `Porta 3000 já está em uso` | Servidor antigo ainda em execução em segundo plano. | Finalize o processo antigo no terminal ou feche e reabra o terminal. |
| `SERVICE_DISABLED` | Google Ads API desativada. | Ative a API no Google Cloud Console. |
| `USER_PERMISSION_DENIED` | O login não acessa essa conta. | Peça acesso ao cliente ou informe o ID do MCC. |

### Específicos de Angular (Oficial)

| Sintoma | Causa provável | Solução guiada |
|---|---|---|
| `ng: command not found` | Dependências de `web/` não instaladas. | `npm run install:all` e use `npm --prefix web ...` (ou `npm start`). |
| Tela em branco ou "Rota não encontrada" | Rodou só `npm run web`; a API não subiu. | Use `npm start`, que sobe API e painel juntos. |
| `Porta 4200 já está em uso` | Outro `ng serve` ou o painel React ainda aberto. | Pare o outro processo; não rode Angular e React na mesma porta. |
| Classes DaisyUI/Tailwind sem efeito | Classe montada em tempo de execução, ou fora do `@source "./app"`. | Escreva a classe por inteiro e dentro de `web/src/app`. |
| Erro de tipos de template (NG...) | Template usando sintaxe de outra stack. | Reveja `@if`/`@for`/signals; não cole JSX/hooks em templates. |
| Teste falha com `inject()` fora de contexto | Teste sem `TestBed`. | Rode os testes pelo Angular (`npm --prefix web test -- --watch=false`). |

### Específicos de React com Vite

| Sintoma | Causa provável | Solução guiada |
|---|---|---|
| `vite: command not found` | Dependências da pasta React não instaladas. | `npm --prefix <pasta-react> install` e rode com `--prefix` (ou dentro da pasta React). |
| `/api/...` retorna 404 ou HTML | Proxy do Vite ausente ou API desligada. | Configure `server.proxy` `/api` → `http://127.0.0.1:3000` (`react.md` §3) e suba `npm run server`. |
| `Failed to resolve import "@shared/..."` | Alias ausente em `vite.config.ts` **ou** em `tsconfig`. | Configure nos dois (`resolve.alias` e `compilerOptions.paths`). |
| Vite recusa servir arquivo fora da pasta (`/@fs/... not allowed`) | `server.fs.allow` não inclui `web/`. | Adicione `../web` (Opção A) ou `../open-ads/web` (Opção B) em `server.fs.allow`. |
| `Cannot find module '@angular/core'` ao importar código compartilhado | O arquivo importado depende de Angular. | Não importe esse arquivo; separe a lógica pura (§3, regra 3) e use só a parte pura. |
| DaisyUI sem estilo / tema errado | Falta `@plugin "daisyui"` no CSS, plugin `@tailwindcss/vite` ausente, ou `data-theme` não aplicado. | Veja `react.md` §4; reaproveite os temas de `web/src/styles.css`. |
| Classes do Tailwind não geradas | Classe montada dinamicamente ou `@source` não cobre `.tsx`. | Escreva a classe inteira e inclua `src/**/*.tsx` no `@source`. |
| `Porta 4200 já está em uso` | O Angular (`npm start`) ainda está rodando. | Pare o Angular antes de subir o React, ou use a porta 4201 no React (e inclua-a nas origens OAuth se o cliente for "Aplicativo da Web"). |
| Opção B: `Failed to resolve import "@shared/..."` mesmo com alias | O nome da pasta do repositório no alias não bate (`../open-ads/...`) ou as pastas não são irmãs. | Confira com `ls ..` e ajuste `<caminho-shared>` no `vite.config.ts` e no `tsconfig`. |
| `npm run doctor` avisa "Dependências do painel (web/)" | `web/node_modules` ausente. | Rode `npm run install:all`; o código compartilhado e o doctor dependem de `web/`. |
| Vitest não acha `*.spec.ts` do domínio | `include` do Vitest só olha `src/`. | Inclua `<caminho-shared>/domain/**/*.spec.ts` no `test.include`. |

### Quando o erro não é da lista
1. Confirme **qual stack** a pessoa está rodando (§0) antes de qualquer correção; a causa mais comum é um comando da stack errada.
2. Peça a mensagem de erro **sem chaves** (oriente a apagar qualquer valor secreto antes de colar).
3. Rode `npm run doctor` e compare com o `INSTALL.md`.
