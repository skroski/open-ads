import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BatchNegatives } from '../../core/batch-negatives';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { cpc, ctr } from '../../domain/metrics';
import { SearchTermRow, TermCategory } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { Icon } from '../../shared/icon';
import { TERM_CATEGORY_CLASS, TERM_CATEGORY_LABEL } from '../../shared/labels';
import { ExportData, PageHeader } from '../../shared/page-header';

type SortKey = 'COST' | 'CLICKS' | 'CONVERSIONS' | 'ALPHA';
type ConversionFilter = 'ALL' | 'WITH' | 'WITHOUT';

const PAGE_SIZE = 150;

@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, PercentPipe, DataState, Icon, PageHeader],
  template: `
    <app-page-header
      group="Operação no Google Ads"
      title="Termos de pesquisa"
      subtitle="O que as pessoas realmente digitaram antes de clicar no seu anúncio. Selecione vários termos para negativar de uma vez."
      [exportData]="exportData()"
    >
      @if (unqualified().length) {
        <button type="button" class="btn btn-error btn-sm" (click)="negateUnqualified()">
          <app-icon name="ban" size="sm" />
          Negativar os {{ unqualified().length }} sem intenção de compra
        </button>
      }
    </app-page-header>

    <app-data-state
      [loading]="ws.searchTermsRaw.loading()"
      [error]="ws.searchTermsRaw.error()"
      [hasData]="!!ws.searchTermsRaw.value()"
      (retry)="ws.searchTermsRaw.reload()"
    >
      <div class="flex flex-col gap-block">
        @if (coverage(); as cov) {
          <div role="note" class="alert alert-soft alert-info">
            <app-icon name="info" />
            <span class="text-sm">
              Estes termos explicam
              <strong>{{ cov.ratio | percent: '1.0-0' }}</strong>
              do custo das campanhas de Pesquisa. O restante vem de termos de baixo volume que o Google não
              exibe, então não dá para julgá-lo por aqui.
            </span>
          </div>
        }

        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div class="flex items-center justify-between text-sm">
              <h2 class="font-semibold">Filtros</h2>
              <span class="text-base-content/60 tabular">
                {{ filtered().length }} de {{ terms().length }} termos
              </span>
            </div>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <input
                type="search"
                class="input input-sm w-full lg:col-span-2"
                placeholder="Buscar termo ou campanha…"
                aria-label="Buscar termo ou campanha"
                [value]="query()"
                (input)="query.set(val($event))"
              />
              <select class="select select-sm w-full" aria-label="Categoria" [value]="category()" (change)="category.set(val($event))">
                <option value="ALL">Todas as categorias</option>
                <option value="UNQUALIFIED">Sem intenção de compra</option>
                <option value="BRAND">Marca</option>
                <option value="QUALIFIED">Qualificado</option>
                <option value="COMPETITOR">Concorrente</option>
                <option value="GENERAL">Geral</option>
              </select>
              <select class="select select-sm w-full" aria-label="Campanha" (change)="campaign.set(val($event))">
                <option value="ALL" [selected]="campaign() === 'ALL'">Todas as campanhas</option>
                @for (c of campaigns(); track c.id) {
                  <option [value]="c.id" [selected]="campaign() === c.id">{{ c.name }}</option>
                }
              </select>
              <select class="select select-sm w-full" aria-label="Conversões" [value]="conversion()" (change)="conversion.set(val($event))">
                <option value="ALL">Com ou sem conversão</option>
                <option value="WITH">Só com conversão</option>
                <option value="WITHOUT">Só sem conversão</option>
              </select>
              <select class="select select-sm w-full" aria-label="Ordenar por" [value]="sort()" (change)="sort.set(val($event))">
                <option value="COST">Maior custo</option>
                <option value="CLICKS">Mais cliques</option>
                <option value="CONVERSIONS">Mais conversões</option>
                <option value="ALPHA">A–Z</option>
              </select>
            </div>
          </div>
        </section>

        @if (selected().length) {
          <div role="status" class="alert alert-soft">
            <app-icon name="check" />
            <span class="text-sm">
              <strong>{{ selected().length }}</strong>
              {{ selected().length === 1 ? 'termo selecionado' : 'termos selecionados' }}
            </span>
            <div class="flex gap-2">
              <button type="button" class="btn btn-ghost btn-sm" (click)="selected.set([])">Limpar</button>
              <button type="button" class="btn btn-error btn-sm" (click)="batch.show(selected())">
                <app-icon name="ban" size="sm" /> Negativar selecionados
              </button>
            </div>
          </div>
        }

        <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table class="table table-sm">
            <thead>
              <tr>
                <th class="w-8">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    aria-label="Selecionar todos os visíveis"
                    [checked]="allVisibleSelected()"
                    (change)="toggleAll()"
                  />
                </th>
                <th>Termo</th>
                <th>Classificação</th>
                <th>Campanha</th>
                <th class="text-right">Impressões</th>
                <th class="text-right">Cliques</th>
                <th class="text-right">CTR</th>
                <th class="text-right">CPC</th>
                <th class="text-right">Custo</th>
                <th class="text-right">Conversões</th>
                <th class="text-right">Custo/conv.</th>
                <th><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              @for (t of visible(); track t.term + '|' + t.campaignId + '|' + t.adGroupId) {
                <tr class="hover:bg-base-200/60" [class.bg-base-200]="isSelected(t.term)">
                  <td>
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      [attr.aria-label]="'Selecionar ' + t.term"
                      [checked]="isSelected(t.term)"
                      (change)="toggle(t.term)"
                    />
                  </td>
                  <td class="max-w-xs">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium break-words">{{ t.term }}</span>
                      @if (t.alreadyNegative) {
                        <span class="badge badge-ghost badge-xs" title="Já bloqueado por uma palavra negativa">negativado</span>
                      }
                    </div>
                  </td>
                  <td>
                    <span [class]="catClass(t.category)" [attr.title]="t.categoryReason">{{ catLabel(t.category) }}</span>
                  </td>
                  <td class="max-w-48 truncate text-base-content/70" [attr.title]="t.campaignName">{{ t.campaignName }}</td>
                  <td class="text-right tabular">{{ t.impressions | number: '1.0-0' }}</td>
                  <td class="text-right tabular">{{ t.clicks | number: '1.0-0' }}</td>
                  <td class="text-right tabular text-base-content/70">{{ rctr(t) | percent: '1.1-1' }}</td>
                  <td class="text-right tabular">{{ rcpc(t) | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                  <td class="text-right tabular font-semibold">{{ t.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                  <td class="text-right tabular" [class]="t.conversions > 0 ? 'text-success' : 'text-base-content/50'">
                    {{ t.conversions | number: '1.0-1' }}
                  </td>
                  <td class="text-right tabular">
                    @if (t.conversions > 0) {
                      {{ t.cost / t.conversions | currency: 'BRL' : 'symbol' : '1.2-2' }}
                    } @else {
                      <span class="text-base-content/40">—</span>
                    }
                  </td>
                  <td class="whitespace-nowrap">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      title="Negativar este termo"
                      [disabled]="t.alreadyNegative"
                      (click)="batch.show([t.term])"
                    >
                      Negativar
                    </button>
                    <button type="button" class="btn btn-ghost btn-xs btn-square" title="Copiar [termo]" aria-label="Copiar termo" (click)="copy(t.term)">
                      <app-icon name="copy" size="xs" />
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="11" class="py-12 text-center text-base-content/60">
                    Nenhum termo encontrado com os filtros atuais.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (filtered().length > shown()) {
          <div class="flex justify-center">
            <button type="button" class="btn btn-sm" (click)="shown.set(shown() + pageSize)">
              Mostrar mais ({{ filtered().length - shown() }} restantes)
            </button>
          </div>
        }
      </div>
    </app-data-state>
  `,
})
export class TermsPage {
  protected readonly ws = inject(Workspace);
  protected readonly batch = inject(BatchNegatives);
  private readonly toast = inject(ToastService);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly query = signal('');
  protected readonly category = signal<'ALL' | TermCategory>('ALL');
  protected readonly campaign = signal('ALL');
  protected readonly conversion = signal<ConversionFilter>('ALL');
  protected readonly sort = signal<SortKey>('COST');
  protected readonly selected = signal<string[]>([]);
  protected readonly shown = signal(PAGE_SIZE);

  protected readonly terms = this.ws.terms;
  protected readonly campaigns = computed(() => this.ws.campaigns.value() ?? []);

  protected readonly unqualified = computed(() =>
    this.terms().filter((t) => t.category === 'UNQUALIFIED' && !t.alreadyNegative),
  );

  /** Quanto do custo de Pesquisa os termos visíveis explicam. */
  protected readonly coverage = computed(() => {
    const campaigns = this.campaigns().filter((c) => c.channel === 'SEARCH');
    const searchCost = campaigns.reduce((s, c) => s + c.cost, 0);
    if (searchCost <= 0) return null;
    const ids = new Set(campaigns.map((c) => c.id));
    const covered = this.terms()
      .filter((t) => ids.has(t.campaignId))
      .reduce((s, t) => s + t.cost, 0);
    return { ratio: Math.min(1, covered / searchCost) };
  });

  protected readonly filtered = computed<SearchTermRow[]>(() => {
    const q = this.query().toLowerCase().trim();
    const cat = this.category();
    const camp = this.campaign();
    const conv = this.conversion();
    const sort = this.sort();
    const list = this.terms().filter((t) => {
      if (q && !t.term.includes(q) && !t.campaignName.toLowerCase().includes(q)) return false;
      if (cat !== 'ALL' && t.category !== cat) return false;
      if (camp !== 'ALL' && t.campaignId !== camp) return false;
      if (conv === 'WITH' && t.conversions <= 0) return false;
      if (conv === 'WITHOUT' && t.conversions > 0) return false;
      return true;
    });
    return list.sort((a, b) => {
      switch (sort) {
        case 'CLICKS':
          return b.clicks - a.clicks;
        case 'CONVERSIONS':
          return b.conversions - a.conversions;
        case 'ALPHA':
          return a.term.localeCompare(b.term, 'pt-BR');
        default:
          return b.cost - a.cost;
      }
    });
  });

  protected readonly visible = computed(() => this.filtered().slice(0, this.shown()));

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'termos-de-pesquisa',
    rows: this.filtered().map((t) => ({
      Termo: t.term,
      Campanha: t.campaignName,
      Grupo: t.adGroupName,
      Classificação: TERM_CATEGORY_LABEL[t.category],
      'Já negativado': t.alreadyNegative ? 'sim' : '',
      Impressões: t.impressions,
      Cliques: t.clicks,
      'Custo (R$)': Math.round(t.cost * 100) / 100,
      Conversões: Math.round(t.conversions * 10) / 10,
    })),
  }));

  protected readonly allVisibleSelected = computed(() => {
    const v = this.visible();
    if (!v.length) return false;
    const s = new Set(this.selected());
    return v.every((t) => s.has(t.term));
  });

  constructor() {
    this.ws.searchTermsRaw.need();
    this.ws.campaigns.need();
    this.ws.negatives.need();
    this.ws.info.need();
  }

  protected val(event: Event): never {
    return (event.target as HTMLInputElement | HTMLSelectElement).value as never;
  }

  protected rctr = (t: SearchTermRow): number => ctr(t);
  protected rcpc = (t: SearchTermRow): number => cpc(t);
  protected catClass = (c: TermCategory): string => TERM_CATEGORY_CLASS[c];
  protected catLabel = (c: TermCategory): string => TERM_CATEGORY_LABEL[c];

  protected isSelected(term: string): boolean {
    return this.selected().includes(term);
  }

  protected toggle(term: string): void {
    this.selected.update((list) => (list.includes(term) ? list.filter((t) => t !== term) : [...list, term]));
  }

  protected toggleAll(): void {
    const visible = this.visible().map((t) => t.term);
    if (this.allVisibleSelected()) {
      const drop = new Set(visible);
      this.selected.update((list) => list.filter((t) => !drop.has(t)));
    } else {
      this.selected.update((list) => Array.from(new Set([...list, ...visible])));
    }
  }

  protected negateUnqualified(): void {
    this.batch.show(this.unqualified().map((t) => t.term));
  }

  protected async copy(term: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(`[${term}]`);
      this.toast.info(`Copiado: [${term}]`);
    } catch {
      this.toast.warning('Não foi possível copiar. Selecione o texto manualmente.');
    }
  }
}
