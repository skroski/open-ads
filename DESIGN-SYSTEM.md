# Design system

Como a interface foi construída e como trocar o visual pelo do seu design system, sem mexer na lógica.

## Base

| Peça | Versão | Papel |
|---|---|---|
| Angular | 22 | Componentes standalone, signals, `@if`/`@for`, signal forms |
| Tailwind CSS | 4 | Utilitários e tokens (`@theme`) |
| daisyUI | 5 | Componentes CSS (card, stat, alert, table, badge, modal, menu, dropdown…) e temas |
| Apache ECharts | 6 | Gráficos (barras, linhas, rosca), com importação modular |
| Fontes | Jost, Oswald, JetBrains Mono | Texto, números e rótulos, códigos e IDs (Google Fonts, em `web/src/index.html`) |

A skill do daisyUI em `.agents/skills/daisyui` ensina às IAs as classes certas. Peça para ela ser usada ao criar telas.

## Onde fica cada coisa

| O quê | Arquivo |
|---|---|
| Cores dos temas claro e escuro (`@plugin "daisyui/theme"`) | `web/src/styles.css` |
| Escala de espaço e tipografia, fontes (`@theme`) | `web/src/styles.css` |
| Menu lateral, botão primário com gradiente, link de destaque | `web/src/styles.css` (`.ads-sidebar`, `.btn-primary`, `@utility link-brand`) |
| Nome e logo em texto | `web/src/app/brand.ts` |
| Logo (ícone) e estrutura da página | `web/src/app/app.html` |
| Cores dos gráficos e dos veredictos | `web/src/app/shared/echart.ts` (`VERDICT_COLOR`) |
| Selos de categoria (Desperdício, Caro, Bom…) | `web/src/app/shared/waste-category.ts` |

## Escala modular

- **Espaço (base 4 px):** 4 · 8 · 12 · 16 · 24 · 32 · 48 → Tailwind `1 · 2 · 3 · 4 · 6 · 8 · 12`.
  - Entre blocos da página: `gap-block` (24 px; 16 px no celular).
  - Dentro de cartões: `--spacing-card`.
- **Tipografia (razão ~1,2):** 12 · 14 · 16 · 20 · 24 · 30 · 36 → `text-xs` … `text-4xl`.

## Componentes compartilhados (`web/src/app/shared/`)

| Componente | Uso |
|---|---|
| `app-page-header` | Grupo, título, subtítulo, botão Atualizar e exportação CSV |
| `app-kpi` | Cartão de indicador (daisyUI `stat`), com variação e se "subir é bom" |
| `app-diagnosis` | Faixa de diagnóstico (`alert`) com tom ruim, atenção, info ou ok |
| `app-bar-list` | Lista com barras de progresso |
| `app-evidence-list` | Lista de evidências ("de onde vem este número") |
| `app-echart` | Gráfico ECharts que segue o tema claro/escuro |
| `app-data-state` | Carregando, erro ou vazio, com o conteúdo em `flex flex-col gap-block` |
| `app-modal`, `app-toasts`, `app-icon`, `app-theme-toggle` | Infraestrutura de interface |

## Trocar pelo seu design system

1. **Cores:** edite as variáveis `--color-*` dos dois blocos `@plugin "daisyui/theme"` em `styles.css`. Use os nomes semânticos do daisyUI (`primary`, `base-100`, `error`…). Assim, todos os componentes acompanham.
2. **Cantos e bordas:** `--radius-box`, `--radius-field`, `--radius-selector` e `--border`, no mesmo bloco.
3. **Fontes:** troque o `<link>` em `index.html` e as variáveis `--font-sans`, `--font-display` e `--font-mono` em `@theme`.
4. **Densidade:** ajuste `--spacing-block` e `--spacing-card`.
5. **Menu lateral e logo:** `.ads-sidebar` em `styles.css`, o ícone em `app.html` e o texto em `brand.ts`.
6. **Gráficos:** `VERDICT_COLOR` em `echart.ts`. Mantenha o vermelho para desperdício e o verde para bom, para não inverter o significado.
7. Rode `npm --prefix web run build` e confira os dois temas no botão de sol/lua.

**Usar outra biblioteca de componentes** (Material, PrimeNG, shadcn…): as telas usam classes do daisyUI direto no HTML. O caminho mais seguro é trocar primeiro os componentes de `shared/` e depois as telas, uma por vez. A lógica (`core/`, `domain/`, `data/`) não depende do visual.

## Regras de implementação

- **Classes do Tailwind devem aparecer escritas por inteiro no código.** Montar o nome em tempo de execução (`progress-${tom}`) faz a classe sumir do CSS final. Use um mapa com as classes literais, como em `bar-list.ts`.
- Use as cores semânticas do daisyUI. Hex fixo só em gráficos.
- Todo número na tela deve indicar a fonte (Google Ads, GA4, Search Console ou CSV importado). Nada de valores de exemplo em telas reais.
- Garanta o layout a partir de 375 px de largura, sem rolagem horizontal da página.
