# Instruções para agentes de código

Painel de análise de Google Ads: Angular 22 + Tailwind 4 + daisyUI 5 + ECharts 6 no front (`web/`), e funções Node.js em `api/` servidas localmente por `server/index.mjs` ou pela Vercel.

## Instalação para uma pessoa (prioridade)

Se alguém pedir para instalar, configurar, rodar ou "colocar no ar" o painel, use a skill **`instalar-painel`** (`.agents/skills/instalar-painel/SKILL.md`, também em `.claude/skills/`). Siga o `INSTALL.md`, uma etapa por vez, e faça as perguntas iniciais da skill.

## Regras de segurança (sem exceção)

- Nunca peça, aceite, repita, grave ou faça commit de chaves: Client Secret, refresh token, chave da Anthropic, JSON do cliente OAuth.
- Quem preenche as chaves é a própria pessoa, no terminal dela: `npm run setup`.
- Nunca leia nem imprima `server/.env`. Para conferir, use `npm run doctor` (só mostra nomes).
- Ações que escrevem no Google Ads (negativas, pausar, lances) só com confirmação explícita da pessoa.
- Não remova `LICENSE`, `NOTICE` nem o crédito "Criado por" da interface: a licença exige.

## Comandos

```bash
npm run install:all      # dependências (raiz + web)
npm run setup            # assistente de chaves → server/.env
npm start                # API :3000 + painel :4200
npm run doctor           # diagnóstico
npm run token            # renovar só o refresh token
npm --prefix web test    # testes do painel (Vitest)
npm run test:api         # testes da API
npm --prefix web run build
```

## Convenções

- Edite as funções sempre em `api/` e rode `npm run sync:api`: `web/api/` é uma cópia, para a Vercel aceitar a raiz em `web/`.
- Marca e textos de exemplo ficam em `web/src/app/brand.ts`. Não espalhe nomes de marca pelo código.
- Visual: siga `DESIGN-SYSTEM.md`, as classes do daisyUI (skill `.agents/skills/daisyui`) e escreva as classes por inteiro, nunca montadas em tempo de execução.
- Angular: componentes standalone, signals (`signal`, `computed`, `linkedSignal`, `resource`), `@if`/`@for`, signal forms, `ChangeDetectionStrategy.OnPush`.
- Regras de negócio puras ficam em `web/src/app/domain/`, com testes `*.spec.ts`.
- Textos da interface em português do Brasil. Todo número exibido deve indicar a fonte, sem dados inventados.
- Depois de mudar código: rode os testes e o build.
