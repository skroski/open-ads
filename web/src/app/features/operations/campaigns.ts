import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Workspace } from '../../core/workspace';
import { CHANNEL_LABEL } from '../../domain/format';
import { cpc, ctr } from '../../domain/metrics';
import { CampaignRow, ChannelType } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { ExportData, PageHeader } from '../../shared/page-header';
import { Insights } from '../../core/insights';
import { brl } from '../../domain/format';
import { wasteCategory } from '../../domain/waste';
import { DisplayDemographics } from './display-demographics';
import { EChart, VERDICT_COLOR } from '../../shared/echart';
import { Kpi } from '../../shared/kpi';
import { ThSort, SortDirection } from '../../shared/th-sort';
import { BADGE_TONE, CATEGORY } from '../../shared/waste-category';
import type { EChartsCoreOption } from 'echarts/core';

const STATUS_LABEL: Record<string, string> = {
  ENABLED: 'Ativa',
  PAUSED: 'Pausada',
  REMOVED: 'Removida',
};

interface Row extends CampaignRow {
  previous?: CampaignRow;
}

@Component({
  selector: 'app-campaigns-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, PercentPipe, DataState, DisplayDemographics, EChart, Kpi, PageHeader, ThSort],
  template: `
    <app-page-header data-open-help="campanhas-introducao"
      group="Operação no Google Ads"
      title="Campanhas"
      subtitle="Desempenho de cada campanha no período, comparado com o período imediatamente anterior."
      [exportData]="exportData()"
    />

    <app-data-state
      [loading]="ws.campaigns.loading()"
      [error]="ws.campaigns.error()"
      [hasData]="!!ws.campaigns.value()"
      (retry)="ws.campaigns.reload()"
    >
      <div class="stats" data-open-help="campanhas-indicadores">
        <app-kpi label="Investimento" [value]="money(totals().cost)" [delta]="change(totals().cost, totals().prevCost)" goodWhen="neutral" tip="Custo de todas as campanhas no período." />
        <app-kpi label="Cliques" [value]="totals().clicks.toLocaleString('pt-BR')" [delta]="change(totals().clicks, totals().prevClicks)" tip="Cliques pagos no período." />
        <app-kpi label="Conversões" [value]="totals().conversions.toLocaleString('pt-BR', { maximumFractionDigits: 1 })" [delta]="change(totals().conversions, totals().prevConversions)" tip="Conversões contadas pelo Google Ads (o que cada uma significa depende da configuração do funil)." />
        <app-kpi
          label="Custo por conversão"
          [value]="totals().conversions ? money(totals().cost / totals().conversions) : '—'"
          [unavailable]="!totals().conversions"
          [delta]="cpaDelta()"
          goodWhen="down"
          tip="Quanto custou, em média, cada conversão. Cair é bom."
        />
      </div>

      @if (chart(); as option) {
        <section class="card card-border bg-base-100" data-open-help="campanhas-grafico">
          <div class="card-body gap-4">
            <h2 class="text-base font-semibold">Custo por campanha: período atual × anterior</h2>
            <p class="text-sm text-base-content/70">O anterior tem a mesma duração e termina no dia antes do início do atual.</p>
            <app-echart [option]="option" [height]="chartHeight()" label="Custo de cada campanha no período atual e no anterior" />
          </div>
        </section>
      }

      <app-display-demographics />

      <div class="flex flex-col gap-3" data-open-help="campanhas-tabela">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <input
              type="search"
              class="input input-sm w-full sm:w-64"
              placeholder="Buscar campanha…"
              aria-label="Buscar campanha"
              [value]="query()"
              (input)="query.set(val($event))"
            />
            <select class="select select-sm" aria-label="Filtrar por status" [value]="statusFilter()" (change)="statusFilter.set(val($event))">
              <option value="ALL">Todos os status</option>
              <option value="ENABLED">Ativas</option>
              <option value="PAUSED">Pausadas</option>
            </select>
            <select class="select select-sm" aria-label="Filtrar por canal" [value]="channelFilter()" (change)="channelFilter.set(val($event))">
              <option value="ALL">Todos os tipos</option>
              @for (ch of channels(); track ch) {
                <option [value]="ch">{{ channel(ch) }}</option>
              }
            </select>
          </div>
          <span class="text-sm text-base-content/60 tabular">
            {{ rows().length }} de {{ allRows().length }} campanhas
          </span>
        </div>

        <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table class="table">
            <thead>
              <tr>
                <th>
                  <app-th-sort field="name" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Campanha
                  </app-th-sort>
                </th>
                <th>
                  <app-th-sort field="channel" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Tipo
                  </app-th-sort>
                </th>
                <th>
                  <app-th-sort field="status" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Status
                  </app-th-sort>
                </th>
                <th>
                  <app-th-sort field="category" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Leitura
                  </app-th-sort>
                </th>
                <th class="text-right">
                  <app-th-sort field="impressions" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Impressões
                  </app-th-sort>
                </th>
                <th class="text-right">
                  <app-th-sort field="clicks" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Cliques
                  </app-th-sort>
                </th>
                <th class="text-right">
                  <app-th-sort field="ctr" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    CTR
                  </app-th-sort>
                </th>
                <th class="text-right">
                  <app-th-sort field="cpc" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    CPC
                  </app-th-sort>
                </th>
                <th class="text-right">
                  <app-th-sort field="cost" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Custo
                  </app-th-sort>
                </th>
                <th class="text-right">
                  <app-th-sort field="conversions" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Conversões
                  </app-th-sort>
                </th>
                <th class="text-right">
                  <app-th-sort field="cpa" align="right" [current]="sortKey()" [direction]="sortDir()" (sort)="onSort($event)">
                    Custo/conv.
                  </app-th-sort>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (c of rows(); track c.id) {
                <tr class="hover:bg-base-200/60">
                  <td class="max-w-72">
                    <div class="font-medium break-words">{{ c.name }}</div>
                  </td>
                  <td><span class="badge badge-soft badge-sm">{{ channel(c.channel) }}</span></td>
                  <td>
                    <span class="inline-flex items-center gap-2 text-xs">
                      <span class="status" [class.status-success]="c.status === 'ENABLED'" [class.status-warning]="c.status === 'PAUSED'"></span>
                      {{ statusLabel(c.status) }}
                    </span>
                  </td>
                  <td>
                    @if (categoryOf(c.id); as cat) {
                      <span [class]="'badge badge-soft badge-sm whitespace-nowrap ' + badge[cat]" [attr.title]="info[cat].tip">{{ info[cat].label }}</span>
                    }
                  </td>
                  <td class="text-right tabular">{{ c.impressions | number: '1.0-0' }}</td>
                  <td class="text-right tabular">{{ c.clicks | number: '1.0-0' }}</td>
                  <td class="text-right tabular text-base-content/70">{{ ratioCtr(c) | percent: '1.1-1' }}</td>
                  <td class="text-right tabular">{{ ratioCpc(c) | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                  <td class="text-right tabular font-semibold">
                    {{ c.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}
                    @if (delta(c.cost, c.previous?.cost); as d) {
                      <div class="text-xs font-normal text-base-content/60">{{ d }} vs. anterior</div>
                    }
                  </td>
                  <td class="text-right tabular">
                    {{ c.conversions | number: '1.0-1' }}
                    @if (delta(c.conversions, c.previous?.conversions); as d) {
                      <div class="text-xs text-base-content/60">{{ d }} vs. anterior</div>
                    }
                  </td>
                  <td class="text-right tabular">
                    @if (c.conversions > 0) {
                      {{ c.cost / c.conversions | currency: 'BRL' : 'symbol' : '1.2-2' }}
                    } @else {
                      <span class="text-base-content/40">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="11" class="py-12 text-center text-base-content/60">
                    Nenhuma campanha encontrada com os filtros atuais.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </app-data-state>
  `,
})
export class CampaignsPage {
  protected readonly ws = inject(Workspace);
  private readonly insights = inject(Insights);
  protected readonly info = CATEGORY;
  protected readonly badge = BADGE_TONE;
  protected money = (v: number): string => brl(v);

  private readonly categories = computed(
    () => new Map(this.insights.wasteCampaigns().map((r) => [r.key, wasteCategory(r)])),
  );
  protected categoryOf = (id: string) => this.categories().get(id);

  protected readonly totals = computed(() => {
    const now = this.ws.campaigns.value() ?? [];
    const prev = this.ws.previousCampaigns.value();
    const sum = (list: readonly CampaignRow[], k: 'cost' | 'clicks' | 'conversions'): number => list.reduce((s, c) => s + c[k], 0);
    return {
      cost: sum(now, 'cost'),
      clicks: sum(now, 'clicks'),
      conversions: sum(now, 'conversions'),
      prevCost: prev ? sum(prev, 'cost') : null,
      prevClicks: prev ? sum(prev, 'clicks') : null,
      prevConversions: prev ? sum(prev, 'conversions') : null,
    };
  });

  /** Variação relativa; null sem base de comparação. */
  protected change(now: number, prev: number | null): number | null {
    return prev ? (now - prev) / prev : null;
  }

  protected readonly cpaDelta = computed(() => {
    const t = this.totals();
    if (!t.conversions || !t.prevConversions || t.prevCost === null) return null;
    return this.change(t.cost / t.conversions, t.prevCost / t.prevConversions);
  });

  protected readonly chartHeight = computed(() => Math.max(180, this.rows().length * 48 + 60));

  protected readonly chart = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows().filter((c) => c.cost > 0 || (c.previous?.cost ?? 0) > 0);
    if (!rows.length) return null;
    const round = (v: number): number => Math.round(v * 100) / 100;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => brl(v) },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 8, bottom: 32, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => brl(v).replace(',00', '') } },
      yAxis: { type: 'category', inverse: true, data: rows.map((c) => c.name), axisLabel: { width: 220, overflow: 'truncate' } },
      series: [
        { name: 'Período atual', type: 'bar', barMaxWidth: 14, itemStyle: { color: '#e98015' }, data: rows.map((c) => round(c.cost)) },
        { name: 'Período anterior', type: 'bar', barMaxWidth: 14, itemStyle: { color: VERDICT_COLOR.insufficient }, data: rows.map((c) => round(c.previous?.cost ?? 0)) },
      ],
    };
  });

  protected readonly query = signal('');
  protected readonly statusFilter = signal<'ALL' | 'ENABLED' | 'PAUSED'>('ALL');
  protected readonly channelFilter = signal('ALL');
  protected readonly sortKey = signal<string>('cost');
  protected readonly sortDir = signal<SortDirection>('desc');

  protected readonly channels = computed(() => {
    const list = this.ws.campaigns.value() ?? [];
    return [...new Set(list.map((c) => c.channel))];
  });

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'campanhas',
    rows: this.rows().map((c) => {
      const cat = this.categoryOf(c.id);
      return {
        Campanha: c.name,
        Tipo: CHANNEL_LABEL[c.channel] ?? c.channel,
        Status: STATUS_LABEL[c.status] ?? c.status,
        Leitura: cat ? CATEGORY[cat].label : '',
        Impressões: c.impressions,
        Cliques: c.clicks,
        'Custo (R$)': Math.round(c.cost * 100) / 100,
        Conversões: Math.round(c.conversions * 10) / 10,
        'Custo anterior (R$)': c.previous ? Math.round(c.previous.cost * 100) / 100 : '',
        'Conversões anteriores': c.previous ? Math.round(c.previous.conversions * 10) / 10 : '',
      };
    }),
  }));

  protected readonly allRows = computed<Row[]>(() => {
    const prev = new Map((this.ws.previousCampaigns.value() ?? []).map((c) => [c.id, c]));
    return (this.ws.campaigns.value() ?? []).map((c) => ({ ...c, previous: prev.get(c.id) }));
  });

  protected readonly rows = computed<Row[]>(() => {
    const q = this.query().toLowerCase().trim();
    const st = this.statusFilter();
    const ch = this.channelFilter();
    const key = this.sortKey();
    const dir = this.sortDir();

    const filtered = this.allRows().filter((c) => {
      if (st !== 'ALL' && c.status !== st) return false;
      if (ch !== 'ALL' && c.channel !== ch) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'name':
          cmp = a.name.localeCompare(b.name, 'pt-BR');
          break;
        case 'channel':
          cmp = this.channel(a.channel).localeCompare(this.channel(b.channel), 'pt-BR');
          break;
        case 'status':
          cmp = this.statusLabel(a.status).localeCompare(this.statusLabel(b.status), 'pt-BR');
          break;
        case 'category': {
          const catA = this.categoryOf(a.id) ?? '';
          const catB = this.categoryOf(b.id) ?? '';
          cmp = catA.localeCompare(catB);
          break;
        }
        case 'impressions':
          cmp = a.impressions - b.impressions;
          break;
        case 'clicks':
          cmp = a.clicks - b.clicks;
          break;
        case 'ctr':
          cmp = this.ratioCtr(a) - this.ratioCtr(b);
          break;
        case 'cpc':
          cmp = this.ratioCpc(a) - this.ratioCpc(b);
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

  constructor() {
    this.insights.needCore();
    this.ws.campaigns.need();
    this.ws.previousCampaigns.need();
  }

  protected onSort(e: { field: string; direction: SortDirection }): void {
    this.sortKey.set(e.field);
    this.sortDir.set(e.direction);
  }

  protected val(event: Event): any {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected channel = (c: ChannelType): string => CHANNEL_LABEL[c] ?? c;
  protected statusLabel = (s: string): string => STATUS_LABEL[s] ?? s;
  protected ratioCtr = (c: CampaignRow): number => ctr(c);
  protected ratioCpc = (c: CampaignRow): number => cpc(c);

  /** "+12%" / "−8%" / "novo". Vazio quando não há base de comparação. */
  protected delta(current: number, previous: number | undefined): string {
    if (previous === undefined) return '';
    if (previous === 0) return current > 0 ? 'novo' : '';
    const change = (current - previous) / previous;
    if (Math.abs(change) < 0.005) return '≈ igual';
    const sign = change > 0 ? '+' : '−';
    return `${sign}${Math.abs(change * 100).toFixed(0)}%`;
  }
}
