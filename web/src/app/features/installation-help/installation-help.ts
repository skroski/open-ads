import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/page-header';

@Component({
  selector: 'app-installation-help-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  template: `
    <app-page-header
      group="Sistema"
      title="Ajuda de instalação"
      subtitle="Um guia passo a passo, com narração em áudio, para preparar o Open Ads no seu computador."
      [refresh]="false"
    />

    <section class="card card-border overflow-hidden bg-base-100">
      <div class="card-body gap-3">
        <div>
          <h2 class="card-title text-base">Instale com o guia narrado</h2>
          <p class="text-sm text-base-content/70">
            Avance no seu ritmo. Cada etapa explica o que fazer e pode ser ouvida com a voz gerada para o projeto.
          </p>
        </div>
        <a
          class="btn btn-sm w-fit"
          href="/guia-instalacao.html"
          target="_blank"
          rel="noopener"
        >
          Abrir em nova janela
        </a>
      </div>

      <iframe
        class="block h-[calc(100vh-15rem)] min-h-[32rem] w-full border-0"
        title="Guia narrado de instalação do Open Ads"
        src="/guia-instalacao.html"
      ></iframe>
    </section>
  `,
})
export class InstallationHelpPage {}
