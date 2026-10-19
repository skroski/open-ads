# Versão React com Vite (alternativa compatível)

Complemento de [`SKILL.md`](SKILL.md). Leia o `SKILL.md` primeiro (§0 escolha da stack, §3 código compartilhado, §4 DaisyUI).

> Esta Skill possui uma versão Oficial em Angular e uma versão compatível em React. A versão React utiliza Vite, TypeScript, Tailwind CSS e DaisyUI, mantendo o mesmo padrão visual e reaproveitando a maior quantidade possível de código TypeScript.

**Princípios**

- React é uma **implementação independente e compatível**, não uma migração do Angular. A versão **Oficial continua sendo o Angular (`web/`)**: não altere, mova nem remova nada nela para "abrir caminho" ao React.
- Mesmo produto: mesmos nomes, fluxos, comportamentos, layout e identidade visual.
- Use esta página **somente em projeto React**. Em projeto Angular, ignore-a.
- Este documento descreve **como instalar e organizar**. Ele não autoriza criar telas, componentes ou integrações novas: isso só acontece quando a pessoa pedir.

> **Estado do repositório:** a versão Angular está completa em `web/`. A **base React já existe em `web-react/`** (Opção A): Vite + TypeScript + Tailwind 4 + daisyUI 5, tema claro/escuro, menu com os mesmos caminhos do Angular, proxy `/api`, alias `@shared` para o TypeScript do Angular e testes (incluindo os `*.spec.ts` de `domain/`). **Telas portadas: Visão geral** (mesmos números e textos do Angular, conferidos lado a lado com dados reais). **As demais ainda são marcadores "não portada", sem dados**: o React ainda não é o painel completo. Porte as telas só quando a pessoa pedir (§7).

Comandos da raiz: `npm run install:react`, `npm run start:react` (API + painel em :4200) e `npm run check:react` (testes + build). Confirme com a detecção da §0 do `SKILL.md`. Se ela não existe e a pessoa escolheu React, siga a §1 abaixo. Não diga que o React "já está pronto" sem ter visto a pasta.

---

## 1. Onde fica a pasta React (e como criá-la em outro lugar)

A **Opção A (`web-react/`) já está no repositório**: use-a como está. As instruções abaixo valem se a pessoa quer a **Opção B (pasta irmã)**, ou se `web-react/` foi removida. Pergunte onde criar (as duas opções funcionam, sem monorepo). Não toque em `web/`.

Atalho para a Opção B: copie `web-react/` (sem `node_modules/` e `dist/`) para a pasta irmã e ajuste os 4 pontos que mencionam `web/` (`vite.config.ts`: `shared`, `publicDir`, `fs.allow`/`repo` e `test.include`; `tsconfig.app.json`: `paths` e `include`; `src/styles.css`: o `@import`). Depois rode `npm install` nela.

| | Opção A · dentro do repositório | Opção B · pasta irmã |
|---|---|---|
| Pasta | `open-ads/web-react/` | `../openads-react/` (ao lado de `open-ads/`) |
| `<pasta-react>` (a partir da raiz do `open-ads`) | `web-react` | `../openads-react` |
| `<caminho-shared>` (da pasta React até `web/src/app`) | `../web/src/app` | `../open-ads/web/src/app` |
| Git | o do `open-ads` | próprio (ou nenhum) |

Os nomes são sugestões; troque `web-react`/`openads-react` pelo que a pessoa preferir, e `open-ads` pelo nome real da pasta do repositório. Execute a partir da raiz do `open-ads`:

```bash
# Opção A
npm create vite@latest web-react -- --template react-ts

# Opção B (cria ao lado de open-ads)
npm create vite@latest ../openads-react -- --template react-ts
```

Depois, com `<pasta-react>` conforme a tabela:

```bash
npm --prefix <pasta-react> install
npm --prefix <pasta-react> install tailwindcss @tailwindcss/vite daisyui echarts react-router-dom
npm --prefix <pasta-react> install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

Na Opção B, o `open-ads` precisa estar instalado (`npm run install:all`) e as duas pastas precisam ficar **no mesmo nível**. Nunca copie `server/.env` nem `api/` para a pasta React.

Versões: use as mesmas major do Oficial para o que for comum (`tailwindcss` 4, `daisyui` 5, `echarts` 6, `typescript`, `vitest`), conferindo em `web/package.json`. Gráficos usam **ECharts**, como no Oficial; não troque de biblioteca.

Scripts esperados no `package.json` da pasta React:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  }
}
```

Regras: **TypeScript desde o início** (sem `.jsx`/`.js` de aplicação), `strict` ligado, e **nenhum pacote `@angular/*`**.

## 2. Compartilhar o TypeScript (sem copiar e sem mexer em `web/`)

O código puro mora em `web/src/app/` (`domain/`, `brand.ts`, `data/ads-normalize.ts`, `data/ads-queries.ts`). O React o importa por alias, usando `<caminho-shared>` da §1.

Já está pronto em `web-react/` (Opção A); em outro lugar, copie estes arquivos e ajuste os caminhos:

- `web-react/vite.config.ts`: `resolve.alias['@shared']`, `publicDir` (reusa `web/public`: logos, favicon, áudios), `server.fs.allow`, `server.proxy['/api']` → `http://127.0.0.1:3000`, porta 4200 e `test.include` com os `*.spec.ts` de `web/src/app/domain`.
- `web-react/tsconfig.app.json`: `paths` (`@shared/*` → `../web/src/app/*`) e `include` (`../web/src/app/domain`, `../web/src/app/brand.ts`).
- Na **Opção B**, troque `web/` por `<caminho-do-open-ads>/web/` nesses caminhos (ex.: `../open-ads/web/src/app`).

Uso: `import { classifyWaste } from '@shared/domain/waste';` (ajuste ao nome real exportado).

**Checklist antes de importar um arquivo de `web/`:**

1. `grep -n "@angular" <arquivo>` não retorna nada.
2. Ele não importa (direta ou indiretamente) outro arquivo que importe `@angular/*`.
3. Se falhar, **não importe**: extraia a parte pura para o compartilhado (só com autorização, `SKILL.md` §3 regra 4) e use só ela.

**Onde a camada React entra** (o que se escreve no React, e só quando necessário):

| Responsabilidade | Angular (Oficial) | React |
|---|---|---|
| Estado reativo | `signal`, `computed`, `linkedSignal`, `resource` | `useState`, `useMemo`, `useReducer`, hooks próprios |
| HTTP | `HttpClient` + interceptors (`access-token.ts`, `manager-ids.ts`) | `fetch` com os mesmos cabeçalhos e o mesmo token de acesso |
| Rotas | `app.routes.ts` | `react-router-dom`, **mesmos caminhos de URL** |
| Persistência local | `local-db.ts`, `collections.ts` (injetáveis) | adaptador React sobre o **mesmo formato** de armazenamento |
| Gráficos | `shared/echart.ts` | wrapper React sobre o mesmo ECharts, **mesmas cores** (`VERDICT_COLOR`) |

Mantenha **contratos idênticos** (nomes de rotas `/api`, formato das respostas, chaves de armazenamento, formato do backup) para que backup e dados da conta funcionem entre as duas versões.

## 3. Executar em desenvolvimento

O `npm start` da raiz (`scripts/dev.mjs`) sobe **só** a API e o Angular. Para React, dois terminais:

```bash
npm run server                           # API em 127.0.0.1:3000 (lê server/.env)
npm --prefix <pasta-react> run dev       # Vite em http://localhost:4200
```

(Na Opção B também dá para entrar na pasta irmã e rodar só `npm run dev`.)

- A porta **4200** é a mesma do Angular de propósito: as origens do OAuth (Etapa 6) não mudam. Por isso `strictPort: true`: se a 4200 estiver ocupada, o Vite avisa em vez de trocar de porta em silêncio. **Pare o Angular antes.**
- **Para ver Angular e React lado a lado:** mantenha o Angular em 4200 (`npm start`, que já sobe a API) e rode **só o React** em 4201 (`port: 4201`), **sem** `npm run server`, porque a API da 3000 já está no ar e as duas interfaces usam a mesma. Se o cliente OAuth for "Aplicativo da Web", acrescente `http://localhost:4201` às origens autorizadas.
- O proxy `/api` replica o `web/proxy.conf.json`, e a API só escuta em `127.0.0.1`: não use CORS para contornar.
- Não modifique `scripts/dev.mjs`, `package.json` da raiz nem `doctor.mjs` para "suportar React" sem pedido da pessoa. Se ela quiser um `npm run start:react`, proponha e peça confirmação.

## 4. DaisyUI, Tailwind e identidade visual

CSS de entrada do React (`web-react/src/styles.css`): **importa o CSS do Oficial**, sem duplicar cores:

```css
@import "../../web/src/styles.css";   /* Opção B: caminho até open-ads/web/src/styles.css */
@source "./";                          /* os @source do arquivo importado são relativos a ele; este cobre os .tsx */
@source "../index.html";
```

- **Fonte da verdade visual:** `web/src/styles.css` (temas claro/escuro, `@theme`, `@utility` como `link-brand`, `tabular`, `table-*`). Reaproveite sem alterar valores. Se o `@import` direto não funcionar, copie os blocos **idênticos** e registre a origem num comentário. Qualquer divergência de cor/espaço é bug.
- **Fontes** (Jost, Oswald, JetBrains Mono): carregue no `index.html` do React como no `web/src/index.html`.
- **Componentes:** monte cada peça com as mesmas classes DaisyUI usadas nos templates Angular (`btn`, `card`, `stat`, `table`, `badge`, `modal`, `menu`, `dropdown`, `tabs`, `alert`…). Para saber qual classe usar, **leia o template Angular equivalente** em `web/src/app/features/**` e `web/src/app/shared/**` e reproduza a estrutura HTML e as classes.
- **Equivalência dos componentes compartilhados** (`app-page-header`, `kpi`, `badges`, `waste-category`, `data-state`…): crie o equivalente React **somente quando a tela que o usa for implementada**, com a mesma aparência.
- **Proibido sem autorização explícita:** shadcn/ui, MUI, Chakra, Ant, Bootstrap ou qualquer outra biblioteca visual; novo Design System; mudar paleta, tipografia, espaçamento ou ícones.
- Classes sempre inteiras (nada de `` `btn-${tipo}` ``): use mapas de classe completos, por exemplo `{ ok: 'badge-success', erro: 'badge-error' }`.

## 5. Testes

- Os `*.spec.ts` de `domain/` são **compartilhados**: devem passar no Vitest do Angular **e** no do React (`include` na §2). Não crie uma segunda cópia dos testes.
- Testes de componentes React (`*.spec.tsx`) ficam na pasta React e cobrem só a camada React.
- Rodar: `npm --prefix web test -- --watch=false` (Angular) e `npm --prefix <pasta-react> test` (React). Depois de mudar código, rode testes **e** build das duas stacks quando tocou em código compartilhado.

## 6. Resumo de comandos

| Ação | Angular (Oficial) | React com Vite |
|---|---|---|
| Instalar | `npm run install:all` | `npm run install:all` + `npm run install:react` (Opção B: `npm --prefix <pasta-react> install`) |
| Chaves e diagnóstico | `npm run setup` / `npm run doctor` | iguais |
| Desenvolvimento | `npm start` | `npm run start:react` (Opção A) · Opção B: `npm run server` + `npm --prefix <pasta-react> run dev` |
| Testes | `npm --prefix web test -- --watch=false` | `npm --prefix <pasta-react> test` |
| Build | `npm --prefix web run build` | `npm --prefix <pasta-react> run build` |
| API (testes/sync) | `npm run test:api` / `npm run sync:api` | iguais |

## 7. Como portar uma nova tela (padrão já usado na Visão geral)

Ao portar uma tela, **leia o `*.ts` e o template da tela em `web/src/app/features/<tela>/`** e reproduza estrutura HTML, classes DaisyUI, textos e regras. Sem inventar dados e sem mudar o visual.

| Camada | Pasta React | Papel |
|---|---|---|
| Regras de negócio | `@shared/domain/*` (em `web/`) | Importar, nunca reescrever. É o que garante os mesmos números. |
| Normalização e consultas GAQL | `@shared/data/ads-normalize`, `ads-queries` | Importar. |
| HTTP | `src/lib/http.ts`, `src/lib/api.ts` | `fetch` com código de acesso (401) e MCC, como os interceptors do Angular. |
| Armazenamento | `src/lib/storage.ts`, `src/lib/localDb.ts` | **Mesmas chaves do localStorage e mesmo banco IndexedDB (`gads-intel`)** do Angular, para os dados valerem nas duas versões. Hoje só leitura. |
| Estado | `src/state/` (`account`, `config`, `workspace`, `insights`, `collections`, `audits`) | Equivalentes dos serviços `AccountStore`, `BusinessConfigStore`, `Workspace`, `Insights`, coleções e `PageAudits`. `insights.ts` só traz o que a Visão geral usa: **amplie conforme a nova tela precisar**, copiando o cálculo do `core/insights.ts` do Angular. |
| Componentes | `src/components/` | Equivalentes dos componentes `shared/` do Angular (`Icon`, `PageHeader`, `DataState`, `FunnelBars`, `Sparkline`, `EChart`, `Logo`…). Ícones e rótulos vêm de `@shared/shared/icons` e `labels`. |
| Tela | `src/features/<tela>/` | Uma por tela; registre a rota em `App.tsx` com `lazy()`. |

Pipes do Angular (`currency`, `number`, `percent`) viram `src/lib/format.ts`. `signal`/`computed` viram `useState`/`useMemo`; `resource` vira `useDataset`.

**Ainda não portado (peça antes de portar):** escrita no Google Ads, gravação em IndexedDB/localStorage, cadastro/importação de contas, ajuda guiada por voz, modais e toasts.

**Como validar uma tela portada:** rode a API (`npm run server`), o Angular em 4201 e o React em 4200, abra a mesma conta e período nos dois e compare os textos (`get_page_text`) e o visual. Acrescente testes com `mockApi` (`src/test-utils.tsx`) cobrindo os números e os estados vazio, carregando e erro.
