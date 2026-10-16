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
import { ThSort, SortDirection } from '../../shared/th-sort';

type ConversionFilter = 'ALL' | 'WITH' | 'WITHOUT';

const PAGE_SIZE = 150;

@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, PercentPipe, DataState, Icon, PageHeader, ThSort],
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
          Negativar os {{ unqualified().length }} não qualificados
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
                <option value="UNQUALIFIED">Não Qualificada</option>
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
              <select class="select select-sm w-full" aria-label="Ordenar por" [value]="sortSelectValue()" (change)="onSortSelect(val($event))">
                <option value="cost_desc">Maior custo</option>
                <option value="clicks_desc">Mais cliques</option>
                <option value="conversions_desc">Mais conversões</option>
                <option value="term_asc">A–Z</option>
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

        <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-xs">
          <table class="table table-sm table-zebra-subtle table-bordered-subtle">
            <thead>
              <tr class="bg-base-200/50 text-xs">
                <th class="w-10 text-center px-2">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    aria-label="Selecionar todos os visíveis"
                    [checked]="allVisibleSelected()"
                    (change)="toggleAll()"
                  />
                </th>
                <th class="min-w-64 max-w-md px-3">
                  <app-th-sort field="term" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Termo
                  </app-th-sort>
                </th>
                <th class="w-36 px-2">
                  <app-th-sort field="category" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Classificação
                  </app-th-sort>
                </th>
                <th class="text-right w-24 px-3">
                  <app-th-sort field="impressions" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Impressões
                  </app-th-sort>
                </th>
                <th class="text-right w-20 px-3">
                  <app-th-sort field="clicks" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Cliques
                  </app-th-sort>
                </th>
                <th class="text-right w-20 px-3">
                  <app-th-sort field="ctr" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    CTR
                  </app-th-sort>
                </th>
                <th class="text-right w-24 px-3">
                  <app-th-sort field="cpc" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    CPC
                  </app-th-sort>
                </th>
                <th class="min-w-44 max-w-64 px-3">
                  <app-th-sort field="campaign" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Campanha
                  </app-th-sort>
                </th>
                <th class="text-right w-24 px-3">
                  <app-th-sort field="cost" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Custo
                  </app-th-sort>
                </th>
                <th class="text-right w-20 px-3">
                  <app-th-sort field="conversions" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Conversões
                  </app-th-sort>
                </th>
                <th class="text-right w-24 px-3">
                  <app-th-sort field="cpa" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Custo/conv.
                  </app-th-sort>
                </th>
                <th class="table-sticky-actions px-3"><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              @for (t of visible(); track t.term + '|' + t.campaignId + '|' + t.adGroupId) {
                <tr [class.bg-base-200]="isSelected(t.term)">
                  <td class="text-center px-2">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      [attr.aria-label]="'Selecionar ' + t.term"
                      [checked]="isSelected(t.term)"
                      (change)="toggle(t.term)"
                    />
                  </td>
                  <td class="min-w-64 max-w-md px-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium break-words leading-snug">{{ t.term }}</span>
                      @if (t.alreadyNegative) {
                        <span class="badge badge-ghost badge-xs" title="Já bloqueado por uma palavra negativa">negativado</span>
                      }
                    </div>
                  </td>
                  <td class="w-36 px-2">
                    <span [class]="catClass(t.category)" [attr.title]="t.categoryReason">{{ catLabel(t.category) }}</span>
                  </td>
                  <td class="text-right tabular px-3">{{ t.impressions | number: '1.0-0' }}</td>
                  <td class="text-right tabular px-3">{{ t.clicks | number: '1.0-0' }}</td>
                  <td class="text-right tabular text-base-content/70 px-3">{{ rctr(t) | percent: '1.1-1' }}</td>
                  <td class="text-right tabular px-3">{{ rcpc(t) | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                  <td class="min-w-44 max-w-64 truncate text-base-content/80 px-3" [attr.title]="t.campaignName">{{ t.campaignName }}</td>
                  <td class="text-right tabular font-semibold px-3">{{ t.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                  <td class="text-right tabular px-3" [class]="t.conversions > 0 ? 'text-success font-medium' : 'text-base-content/50'">
                    {{ t.conversions | number: '1.0-1' }}
                  </td>
                  <td class="text-right tabular px-3">
                    @if (t.conversions > 0) {
                      {{ t.cost / t.conversions | currency: 'BRL' : 'symbol' : '1.2-2' }}
                    } @else {
                      <span class="text-base-content/40">—</span>
                    }
                  </td>
                  <td class="table-sticky-actions whitespace-nowrap px-3">
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
  protected readonly sortKey = signal<string>('cost');
  protected readonly sortDir = signal<SortDirection>('desc');
  protected readonly selected = signal<string[]>([]);
  protected readonly shown = signal(PAGE_SIZE);

  protected readonly sortSelectValue = computed(() => {
    const k = this.sortKey();
    const d = this.sortDir();
    if (k === 'clicks' && d === 'desc') return 'clicks_desc';
    if (k === 'conversions' && d === 'desc') return 'conversions_desc';
    if (k === 'term' && d === 'asc') return 'term_asc';
    return 'cost_desc';
  });

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
    const key = this.sortKey();
    const dir = this.sortDir();

    const list = this.terms().filter((t) => {
      if (q && !t.term.includes(q) && !t.campaignName.toLowerCase().includes(q)) return false;
      if (cat !== 'ALL' && t.category !== cat) return false;
      if (camp !== 'ALL' && t.campaignId !== camp) return false;
      if (conv === 'WITH' && t.conversions <= 0) return false;
      if (conv === 'WITHOUT' && t.conversions > 0) return false;
      return true;
    });

    return list.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'term':
          cmp = a.term.localeCompare(b.term, 'pt-BR');
          break;
        case 'category':
          cmp = (TERM_CATEGORY_LABEL[a.category] ?? '').localeCompare(TERM_CATEGORY_LABEL[b.category] ?? '', 'pt-BR');
          break;
        case 'campaign':
          cmp = a.campaignName.localeCompare(b.campaignName, 'pt-BR');
          break;
        case 'impressions':
          cmp = a.impressions - b.impressions;
          break;
        case 'clicks':
          cmp = a.clicks - b.clicks;
          break;
        case 'ctr':
          cmp = ctr(a) - ctr(b);
          break;
        case 'cpc':
          cmp = cpc(a) - cpc(b);
          break;
        case 'conversions':
          cmp = a.conversions - b.conversions;
          break;
        case 'cpa': {
          const cpaA = a.conversions > 0 ? a.cost / a.conversions : Infinity;
          const cpaB = b.conversions > 0 ? b.cost / b.conversions : Infinity;
          cmp = cpaA - cpaB;
          break;
        }
        case 'cost':
        default:
          cmp = a.cost - b.cost;
          break;
      }
      return dir === 'asc' ? cmp : -cmp;
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

  protected onSort(e: { field: string; direction: SortDirection }): void {
    this.sortKey.set(e.field);
    this.sortDir.set(e.direction);
  }

  protected onSortSelect(val: string): void {
    const [field, dir] = val.split('_') as [string, SortDirection];
    this.sortKey.set(field);
    this.sortDir.set(dir);
  }

  protected val(event: Event): any {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
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
