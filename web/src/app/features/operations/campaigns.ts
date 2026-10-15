import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Workspace } from '../../core/workspace';
import { CHANNEL_LABEL } from '../../domain/format';
import { cpc, ctr } from '../../domain/metrics';
import { CampaignRow, ChannelType } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { ExportData, PageHeader } from '../../shared/page-header';
import { Insights } from '../../core/insights';
import { brl } from '../../domain/format';
import { wasteCategory } from '../../domain/waste';
import { EChart, VERDICT_COLOR } from '../../shared/echart';
import { Kpi } from '../../shared/kpi';
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
  imports: [CurrencyPipe, DecimalPipe, PercentPipe, DataState, EChart, Kpi, PageHeader],
  template: `
    <app-page-header
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
      <div class="stats">
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
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <h2 class="text-base font-semibold">Custo por campanha: período atual × anterior</h2>
            <p class="text-sm text-base-content/70">O anterior tem a mesma duração e termina no dia antes do início do atual.</p>
            <app-echart [option]="option" [height]="chartHeight()" label="Custo de cada campanha no período atual e no anterior" />
          </div>
        </section>
      }

      <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table class="table">
          <thead>
            <tr>
              <th>Campanha</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Leitura</th>
              <th class="text-right">Impressões</th>
              <th class="text-right">Cliques</th>
              <th class="text-right">CTR</th>
              <th class="text-right">CPC</th>
              <th class="text-right">Custo</th>
              <th class="text-right">Conversões</th>
              <th class="text-right">Custo/conv.</th>
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
                  Nenhuma campanha com dados neste período.
                </td>
              </tr>
            }
          </tbody>
        </table>
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

  protected readonly rows = computed<Row[]>(() => {
    const prev = new Map((this.ws.previousCampaigns.value() ?? []).map((c) => [c.id, c]));
    return (this.ws.campaigns.value() ?? [])
      .map((c) => ({ ...c, previous: prev.get(c.id) }))
      .sort((a, b) => b.cost - a.cost);
  });

  constructor() {
    this.insights.needCore();
    this.ws.campaigns.need();
    this.ws.previousCampaigns.need();
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
