import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Workspace } from '../core/workspace';
import { Icon } from './icon';

/** Linhas para o botão Exportar: cada objeto vira uma linha do CSV. */
export interface ExportData {
  name: string;
  rows: ReadonlyArray<Record<string, string | number | null | undefined>>;
}

/**
 * Cabeçalho de cada tela dentro de uma área (o h1 da página é o título da área, no shell): título, subtítulo
 * descrição e um espaço à direita para ações (ex.: Atualizar, Exportar).
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <header class="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h2 class="text-2xl leading-tight font-semibold">
          @if (lead()) {
            {{ lead() }} {{ title() }}
          } @else {
            {{ title() }}
          }
        </h2>
        @if (subtitle()) {
          <p class="mt-1 max-w-3xl text-sm text-base-content/70 text-pretty">{{ subtitle() }}</p>
        }
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <ng-content />
        @if (refresh()) {
          <button type="button" class="btn btn-sm border-base-300 bg-base-100" [disabled]="ws.anyLoading()" (click)="ws.reloadAll()">
            @if (ws.anyLoading()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <app-icon name="refresh" size="sm" />
            }
            Atualizar dados
          </button>
        }
        @if (exportData(); as data) {
          <button type="button" class="btn btn-primary btn-sm" [disabled]="!data.rows.length" (click)="download(data)">
            <app-icon name="download" size="sm" /> Exportar
          </button>
        }
      </div>
    </header>
  `,
})
export class PageHeader {
  /** Grupo do menu, em caixa alta acima do título (ex.: "Inteligência"). */
  readonly group = input('');
  /** Parte do título em destaque, antes do restante (ex.: "Histórico" + "e aprendizado"). */
  readonly lead = input('');
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly refresh = input(true);
  /** Dados exportados em CSV pelo botão Exportar; sem isso o botão não aparece. */
  readonly exportData = input<ExportData | null>(null);

  protected readonly ws = inject(Workspace);

  /** CSV com ponto e vírgula e BOM: abre certo no Excel em português. */
  protected download(data: ExportData): void {
    const cols = Array.from(new Set(data.rows.flatMap((r) => Object.keys(r))));
    const cell = (v: unknown): string => {
      const t = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [cols.join(';'), ...data.rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Safari e alguns Firefox cancelam o download se a URL some antes de ele começar.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
