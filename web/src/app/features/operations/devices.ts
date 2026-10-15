import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Workspace } from '../../core/workspace';
import { deviceLabel } from '../../data/ads-normalize';
import { cpc, ctr } from '../../domain/metrics';
import { Perf } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { ExportData, PageHeader } from '../../shared/page-header';
import { EChart, VERDICT_COLOR } from '../../shared/echart';
import type { EChartsCoreOption } from 'echarts/core';

@Component({
  selector: 'app-devices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, PercentPipe, DataState, EChart, PageHeader],
  template: `
    <app-page-header
      group="Operação no Google Ads"
      title="Dispositivos e redes"
      subtitle="Onde o investimento está sendo gasto e o que ele devolve em cada rede e aparelho."
      [exportData]="exportData()"
    />

    <div class="flex flex-col gap-block">
      <app-data-state
        [loading]="ws.networks.loading()"
        [error]="ws.networks.error()"
        [hasData]="!!ws.networks.value()"
        (retry)="ws.networks.reload()"
      >
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Por rede</h2>
            <p class="text-sm text-base-content/70">Quando a fatia do custo é maior que a das conversões, a rede devolve menos do que consome.</p>
            <app-echart [option]="shareChart(networkShares())" [height]="220" label="Fatia do custo e das conversões por rede" />
            <div class="overflow-x-auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>Rede</th>
                    <th class="text-right">Impressões</th>
                    <th class="text-right">Cliques</th>
                    <th class="text-right">CTR</th>
                    <th class="text-right">Custo</th>
                    <th class="text-right">% do custo</th>
                    <th class="text-right">Conversões</th>
                    <th class="text-right">Custo/conv.</th>
                  </tr>
                </thead>
                <tbody>
                  @for (n of networks(); track n.network) {
                    <tr class="hover:bg-base-200/60">
                      <td class="font-medium">{{ n.label }}</td>
                      <td class="text-right tabular">{{ n.impressions | number: '1.0-0' }}</td>
                      <td class="text-right tabular">{{ n.clicks | number: '1.0-0' }}</td>
                      <td class="text-right tabular text-base-content/70">{{ ratioCtr(n) | percent: '1.1-1' }}</td>
                      <td class="text-right tabular font-semibold">{{ n.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                      <td class="text-right tabular">{{ share(n.cost, networkCost()) | percent: '1.0-0' }}</td>
                      <td class="text-right tabular">{{ n.conversions | number: '1.0-1' }}</td>
                      <td class="text-right tabular">
                        @if (n.conversions > 0) {
                          {{ n.cost / n.conversions | currency: 'BRL' : 'symbol' : '1.2-2' }}
                        } @else {
                          <span class="text-base-content/40">—</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="8" class="py-8 text-center text-base-content/60">Sem dados no período.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </app-data-state>

      <app-data-state
        [loading]="ws.devices.loading()"
        [error]="ws.devices.error()"
        [hasData]="!!ws.devices.value()"
        (retry)="ws.devices.reload()"
      >
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Por dispositivo</h2>
            <p class="text-sm text-base-content/70">Mesma leitura: compare a fatia do custo com a fatia das conversões de cada aparelho.</p>
            <app-echart [option]="shareChart(deviceShares())" [height]="220" label="Fatia do custo e das conversões por dispositivo" />
            <div class="overflow-x-auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>Dispositivo</th>
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
                  @for (d of devices(); track d.device) {
                    <tr class="hover:bg-base-200/60">
                      <td class="font-medium">{{ label(d.device) }}</td>
                      <td class="text-right tabular">{{ d.impressions | number: '1.0-0' }}</td>
                      <td class="text-right tabular">{{ d.clicks | number: '1.0-0' }}</td>
                      <td class="text-right tabular text-base-content/70">{{ ratioCtr(d) | percent: '1.1-1' }}</td>
                      <td class="text-right tabular">{{ ratioCpc(d) | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                      <td class="text-right tabular font-semibold">{{ d.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                      <td class="text-right tabular">{{ d.conversions | number: '1.0-1' }}</td>
                      <td class="text-right tabular">
                        @if (d.conversions > 0) {
                          {{ d.cost / d.conversions | currency: 'BRL' : 'symbol' : '1.2-2' }}
                        } @else {
                          <span class="text-base-content/40">—</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="8" class="py-8 text-center text-base-content/60">Sem dados no período.</td>
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
export class DevicesPage {
  protected readonly ws = inject(Workspace);

  protected readonly networks = computed(() =>
    [...(this.ws.networks.value() ?? [])].sort((a, b) => b.cost - a.cost),
  );
  protected readonly devices = computed(() =>
    [...(this.ws.devices.value() ?? [])].sort((a, b) => b.cost - a.cost),
  );
  protected readonly networkCost = computed(() => this.networks().reduce((s, n) => s + n.cost, 0));

  protected readonly networkShares = computed(() =>
    this.networks().map((n) => ({ label: n.label, cost: n.cost, conversions: n.conversions })),
  );
  protected readonly deviceShares = computed(() =>
    this.devices().map((d) => ({ label: deviceLabel(d.device), cost: d.cost, conversions: d.conversions })),
  );

  /** Barras lado a lado: % do custo × % das conversões de cada item. */
  protected shareChart(items: ReadonlyArray<{ label: string; cost: number; conversions: number }>): EChartsCoreOption {
    const cost = items.reduce((s, i) => s + i.cost, 0);
    const conv = items.reduce((s, i) => s + i.conversions, 0);
    const pctOf = (v: number, t: number): number => (t > 0 ? Math.round((v / t) * 1000) / 10 : 0);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${v}%` },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 8, bottom: 32, containLabel: true },
      xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      yAxis: { type: 'category', inverse: true, data: items.map((i) => i.label) },
      series: [
        { name: '% do custo', type: 'bar', barMaxWidth: 12, itemStyle: { color: '#e98015' }, data: items.map((i) => pctOf(i.cost, cost)) },
        { name: '% das conversões', type: 'bar', barMaxWidth: 12, itemStyle: { color: VERDICT_COLOR.performing }, data: items.map((i) => pctOf(i.conversions, conv)) },
      ],
    };
  }

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'dispositivos-e-redes',
    rows: [
      ...this.networks().map((n) => ({ Tipo: 'Rede', Nome: n.label, Impressões: n.impressions, Cliques: n.clicks, 'Custo (R$)': Math.round(n.cost * 100) / 100, Conversões: Math.round(n.conversions * 10) / 10 })),
      ...this.devices().map((d) => ({ Tipo: 'Dispositivo', Nome: deviceLabel(d.device), Impressões: d.impressions, Cliques: d.clicks, 'Custo (R$)': Math.round(d.cost * 100) / 100, Conversões: Math.round(d.conversions * 10) / 10 })),
    ],
  }));

  constructor() {
    this.ws.networks.need();
    this.ws.devices.need();
  }

  protected label = deviceLabel;
  protected ratioCtr = (p: Perf): number => ctr(p);
  protected ratioCpc = (p: Perf): number => cpc(p);
  protected share = (part: number, total: number): number => (total > 0 ? part / total : 0);
}
