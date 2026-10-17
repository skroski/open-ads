import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, minLength, required } from '@angular/forms/signals';
import { AdsActions } from '../../core/ads-actions';
import { ToastService } from '../../core/toast.service';
import { Insights } from '../../core/insights';
import { Workspace } from '../../core/workspace';
import { brl } from '../../domain/format';
import { NegativeGap } from '../../domain/negatives';
import { MatchType, NegativeKeyword } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { Icon } from '../../shared/icon';
import { MATCH_CLASS, MATCH_LABEL, formatMatch } from '../../shared/labels';
import { ExportData, PageHeader } from '../../shared/page-header';

import { ThSort, SortDirection } from '../../shared/th-sort';

const HINT: Record<MatchType, string> = {
  EXACT: 'Bloqueia só a busca idêntica.',
  PHRASE: 'Bloqueia buscas que contenham a expressão, na mesma ordem.',
  BROAD: 'Bloqueia buscas que contenham as palavras em qualquer ordem.',
};

@Component({
  selector: 'app-negatives-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataState, FormField, FormRoot, Icon, PageHeader, ThSort],
  template: `
    <app-page-header data-open-help="negativas-introducao"
      group="Operação no Google Ads"
      title="Palavras negativas"
      subtitle="Bloqueie buscas sem intenção de compra e veja o que já está bloqueado em cada campanha."
      [exportData]="exportData()"
    />

    <div class="flex flex-col gap-block">
      <section class="card card-border bg-base-100" data-open-help="negativas-criar">
        <div class="card-body gap-4">
          <h2 class="card-title text-base">
            <app-icon name="ban" size="sm" /> Negativar uma palavra agora
          </h2>

          <form [formRoot]="form" class="grid gap-4 md:grid-cols-12">
            <fieldset class="fieldset md:col-span-5">
              <legend class="fieldset-legend">Termo</legend>
              <input
                type="text"
                class="input w-full"
                placeholder="Ex.: curso gratis, vagas, tutorial"
                [formField]="form.text"
              />
              @if (form.text().touched() && form.text().errors().length) {
                <p class="label text-error">{{ form.text().errors()[0].message }}</p>
              }
            </fieldset>

            <fieldset class="fieldset md:col-span-3">
              <legend class="fieldset-legend">Correspondência</legend>
              <select class="select w-full" [formField]="form.matchType">
                <option value="EXACT">Exata [termo]</option>
                <option value="PHRASE">Frase "termo"</option>
                <option value="BROAD">Ampla termo</option>
              </select>
            </fieldset>

            <fieldset class="fieldset md:col-span-4">
              <legend class="fieldset-legend">Campanha</legend>
              <select class="select w-full" [formField]="form.campaignId">
                <option value="">Escolha a campanha…</option>
                @for (c of campaigns(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
              @if (form.campaignId().touched() && form.campaignId().errors().length) {
                <p class="label text-error">{{ form.campaignId().errors()[0].message }}</p>
              }
            </fieldset>

            <div class="flex flex-wrap items-center justify-between gap-3 md:col-span-12">
              <p class="text-sm text-base-content/70">
                Ficará assim no Google Ads:
                <span class="badge badge-neutral font-mono">{{ preview() }}</span>
                <span class="ml-2">{{ hint() }}</span>
              </p>
              <button type="submit" class="btn btn-error" [disabled]="submitting()">
                @if (submitting()) {
                  <span class="loading loading-spinner loading-xs"></span> Enviando…
                } @else {
                  <app-icon name="plus" size="sm" /> Negativar no Google Ads
                }
              </button>
            </div>
          </form>
        </div>
      </section>

      <app-data-state
        [loading]="ws.negatives.loading()"
        [error]="ws.negatives.error()"
        [hasData]="!!ws.negatives.value()"
        (retry)="ws.negatives.reload()"
      >
        <section class="card card-border bg-base-100" data-open-help="negativas-cobertura">
          <div class="card-body gap-4">
            <div>
              <h2 class="card-title text-base">
                <app-icon name="shield" size="sm" /> Cobertura entre campanhas de Pesquisa
              </h2>
              <p class="text-sm text-base-content/70">
                Negativas que valem em algumas campanhas e faltam em outras. Ficam de fora as de marca, as de
                grupo de anúncios e as que bloqueariam uma palavra-chave da própria campanha, porque essas
                costumam ser separação proposital.
              </p>
            </div>

            @if (searchCampaigns() < 2) {
              <p class="text-sm text-base-content/60">
                A conta tem {{ searchCampaigns() }} campanha de Pesquisa no período; a comparação precisa de pelo
                menos duas.
              </p>
            } @else if (!gaps().length) {
              <div role="status" class="alert alert-success alert-soft">
                <app-icon name="check" />
                <span class="text-sm">Todas as negativas de campanha valem em todas as campanhas de Pesquisa.</span>
              </div>
            } @else {
              @if (leakTotal() > 0) {
                <div role="alert" class="alert alert-warning alert-soft">
                  <app-icon name="warning" />
                  <span class="text-sm">
                    {{ money(leakTotal()) }} foram gastos no período em buscas que já estão bloqueadas em outra
                    campanha, mas não nesta.
                  </span>
                </div>
              }
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Negativa</th>
                      <th>Vale em</th>
                      <th>Falta em</th>
                      <th class="text-right">Gasto vazado</th>
                      <th class="table-sticky-actions"><span class="sr-only">Ação</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (g of gaps(); track g.matchType + g.text) {
                      <tr class="align-top hover:bg-base-200/60">
                        <td class="font-mono text-sm">{{ fmt(g.text, g.matchType) }}</td>
                        <td class="max-w-56 text-base-content/70">{{ g.coveredIn.join(', ') }}</td>
                        <td class="max-w-64">
                          @for (m of g.missingIn; track m.campaignId) {
                            <div>
                              {{ m.campaignName }}
                              @if (m.leakTerms.length) {
                                <div class="text-xs text-base-content/60">
                                  {{ m.leakTerms.slice(0, 3).join(', ') }}{{ m.leakTerms.length > 3 ? '…' : '' }}
                                </div>
                              }
                            </div>
                          }
                        </td>
                        <td class="tabular text-right" [class.text-warning]="g.totalLeak > 0">
                          {{ g.totalLeak > 0 ? money(g.totalLeak) : '—' }}
                        </td>
                        <td class="table-sticky-actions text-right">
                          <button
                            type="button"
                            class="btn btn-xs"
                            [disabled]="applying() === g.matchType + g.text"
                            (click)="applyGap(g)"
                          >
                            @if (applying() === g.matchType + g.text) {
                              <span class="loading loading-spinner loading-xs"></span>
                            }
                            Aplicar nas que faltam
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </section>
      </app-data-state>

      <app-data-state
        [loading]="ws.negatives.loading()"
        [error]="ws.negatives.error()"
        [hasData]="!!ws.negatives.value()"
        (retry)="ws.negatives.reload()"
      >
        <section class="card card-border bg-base-100" data-open-help="negativas-lista">
          <div class="card-body gap-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 class="card-title text-base">Bloqueadas na conta ({{ all().length }})</h2>
                <p class="text-sm text-base-content/70">
                  Negativas em vigor agora: de campanha, de grupo de anúncios e de listas compartilhadas.
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <input
                  type="search"
                  class="input input-sm w-full md:w-56"
                  placeholder="Filtrar palavra ou campanha…"
                  aria-label="Filtrar palavras negativas"
                  [value]="query()"
                  (input)="query.set(val($event))"
                />
                <select
                  class="select select-sm"
                  aria-label="Tipo de correspondência"
                  [value]="matchFilter()"
                  (change)="matchFilter.set(val($event))"
                >
                  <option value="ALL">Todas as correspondências</option>
                  <option value="EXACT">Exata</option>
                  <option value="PHRASE">Frase</option>
                  <option value="BROAD">Ampla</option>
                </select>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>
                      <app-th-sort field="text" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                        Palavra
                      </app-th-sort>
                    </th>
                    <th>
                      <app-th-sort field="matchType" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                        Correspondência
                      </app-th-sort>
                    </th>
                    <th>Como aparece</th>
                    <th>
                      <app-th-sort field="campaign" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                        Onde vale
                      </app-th-sort>
                    </th>
                    <th class="table-sticky-actions"><span class="sr-only">Copiar</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (n of filtered(); track n.level + '|' + n.id + '|' + n.campaignId + '|' + n.adGroupId) {
                    <tr class="hover:bg-base-200/60">
                      <td class="font-medium">{{ n.text }}</td>
                      <td><span [class]="matchClass(n.matchType)">{{ matchLabel(n.matchType) }}</span></td>
                      <td class="font-mono text-sm">{{ fmt(n.text, n.matchType) }}</td>
                      <td class="max-w-72 text-base-content/70">
                        <div class="truncate" [attr.title]="n.campaignName">{{ n.campaignName }}</div>
                        <div class="text-xs">{{ scopeOf(n) }}</div>
                      </td>
                      <td class="table-sticky-actions">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          (click)="copy(fmt(n.text, n.matchType))"
                        >
                          Copiar
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="5" class="py-8 text-center text-base-content/60">
                        Nenhuma palavra negativa encontrada.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </app-data-state>
    </div>
  `,
})
export class NegativesPage {
  protected readonly ws = inject(Workspace);
  private readonly insights = inject(Insights);
  private readonly actions = inject(AdsActions);
  private readonly toast = inject(ToastService);

  protected readonly campaigns = computed(() => this.ws.campaigns.value() ?? []);
  protected readonly all = computed(() => this.ws.negatives.value() ?? []);

  protected readonly gaps = this.insights.negativeGaps;
  protected readonly leakTotal = computed(() => this.gaps().reduce((s, g) => s + g.totalLeak, 0));
  protected readonly searchCampaigns = computed(
    () => this.campaigns().filter((c) => c.channel === 'SEARCH').length,
  );
  protected readonly applying = signal<string | null>(null);

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'palavras-negativas',
    rows: this.filtered().map((n) => ({
      Negativa: n.text,
      Correspondência: MATCH_LABEL[n.matchType],
      Campanha: n.campaignName,
      'Onde vale': this.scopeOf(n),
    })),
  }));

  protected readonly query = signal('');
  protected readonly matchFilter = signal<'ALL' | MatchType>('ALL');
  protected readonly submitting = signal(false);

  private readonly value = signal<{ text: string; matchType: MatchType; campaignId: string }>({
    text: '',
    matchType: 'EXACT',
    campaignId: '',
  });

  protected readonly form = form(
    this.value,
    (p) => {
      required(p.text, { message: 'Digite o termo a negativar.' });
      minLength(p.text, 2, { message: 'Use ao menos 2 letras.' });
      required(p.campaignId, { message: 'Escolha a campanha de destino.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.value();
          this.submitting.set(true);
          const result = await this.actions.addNegative(v.campaignId, v.text.trim(), v.matchType);
          this.submitting.set(false);
          if (result.ok) {
            this.toast.success(result.message);
            this.value.update((cur) => ({ ...cur, text: '' }));
            this.form().reset();
          } else {
            this.toast.error(result.message);
          }
          return undefined;
        },
      },
    },
  );

  protected readonly preview = computed(() => {
    const v = this.value();
    const raw = v.text.replace(/[[\]"]/g, '').trim();
    return raw ? formatMatch(raw, v.matchType) : 'digite um termo…';
  });

  protected readonly hint = computed(() => HINT[this.value().matchType]);

  protected readonly sortKey = signal<string>('text');
  protected readonly sortDir = signal<SortDirection>('asc');

  protected onSort(e: { field: string; direction: SortDirection }): void {
    this.sortKey.set(e.field);
    this.sortDir.set(e.direction);
  }

  protected readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    const m = this.matchFilter();
    const key = this.sortKey();
    const dir = this.sortDir();

    const list = this.all().filter(
      (n) =>
        (m === 'ALL' || n.matchType === m) &&
        (!q ||
          n.text.toLowerCase().includes(q) ||
          n.campaignName.toLowerCase().includes(q) ||
          (n.adGroupName ?? '').toLowerCase().includes(q) ||
          (n.listName ?? '').toLowerCase().includes(q)),
    );

    return list.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'matchType':
          cmp = (MATCH_LABEL[a.matchType] ?? '').localeCompare(MATCH_LABEL[b.matchType] ?? '', 'pt-BR');
          break;
        case 'campaign':
          cmp = a.campaignName.localeCompare(b.campaignName, 'pt-BR') || (a.adGroupName ?? '').localeCompare(b.adGroupName ?? '', 'pt-BR');
          break;
        case 'text':
        default:
          cmp = a.text.localeCompare(b.text, 'pt-BR');
          break;
      }
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  constructor() {
    this.ws.negatives.need();
    this.ws.campaigns.need();
    this.ws.keywordsBase.need();
    this.ws.searchTermsRaw.need();
  }

  protected scopeOf(n: NegativeKeyword): string {
    if (n.level === 'AD_GROUP') return `Só no grupo ${n.adGroupName ?? ''}`.trim();
    if (n.level === 'SHARED_LIST') return `Lista compartilhada: ${n.listName ?? ''}`.trim();
    return 'Campanha inteira';
  }

  protected money = (v: number): string => brl(v);

  /** Grava no Google Ads só depois da confirmação explícita. */
  protected async applyGap(g: NegativeGap): Promise<void> {
    const names = g.missingIn.map((m) => m.campaignName).join(', ');
    if (!confirm(`Negativar ${formatMatch(g.text, g.matchType)} em: ${names}?`)) return;
    this.applying.set(g.matchType + g.text);
    const result = await this.actions.negateTerms([g.text], {
      matchType: g.matchType,
      campaignIds: g.missingIn.map((m) => m.campaignId),
    });
    this.applying.set(null);
    if (result.ok) this.toast.success(result.message);
    else this.toast.error(result.message);
  }

  protected val(event: Event): never {
    return (event.target as HTMLInputElement | HTMLSelectElement).value as never;
  }

  protected matchClass = (m: MatchType): string => MATCH_CLASS[m];
  protected matchLabel = (m: MatchType): string => MATCH_LABEL[m];
  protected fmt = (text: string, m: MatchType): string => formatMatch(text, m);

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.info(`Copiado: ${text}`);
    } catch {
      this.toast.warning('Não foi possível copiar.');
    }
  }
}
