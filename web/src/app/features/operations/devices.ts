import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Workspace } from '../../core/workspace';
import { deviceLabel } from '../../data/ads-normalize';
import { cpc, ctr } from '../../domain/metrics';
import { NetworkRow, Perf } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { ExportData, PageHeader } from '../../shared/page-header';
import { EChart, VERDICT_COLOR } from '../../shared/echart';
import { ThSort, SortDirection } from '../../shared/th-sort';
import type { EChartsCoreOption } from 'echarts/core';

@Component({
  selector: 'app-devices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, PercentPipe, DataState, EChart, PageHeader, ThSort],
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
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="card-title text-base">Por rede</h2>
                <p class="text-sm text-base-content/70">Quando a fatia do custo é maior que a das conversões, a rede devolve menos do que consome.</p>
              </div>
              <input
                type="search"
                class="input input-sm w-full sm:w-56"
                placeholder="Filtrar redes…"
                aria-label="Filtrar redes"
                [value]="queryNetworks()"
                (input)="queryNetworks.set(val($event))"
              />
            </div>
            <app-echart [option]="shareChart(networkShares())" [height]="220" label="Fatia do custo e das conversões por rede" />
            <div class="overflow-x-auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>
                      <app-th-sort field="label" [current]="sortKeyNetworks()" [direction]="sortDirNetworks()" (sort)="onSortNetworks($event)">
                        Rede
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="impressions" align="right" [current]="sortKeyNetworks()" [direction]="sortDirNetworks()" (sort)="onSortNetworks($event)">
                        Impressões
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="clicks" align="right" [current]="sortKeyNetworks()" [direction]="sortDirNetworks()" (sort)="onSortNetworks($event)">
                        Cliques
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="ctr" align="right" [current]="sortKeyNetworks()" [direction]="sortDirNetworks()" (sort)="onSortNetworks($event)">
                        CTR
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="cost" align="right" [current]="sortKeyNetworks()" [direction]="sortDirNetworks()" (sort)="onSortNetworks($event)">
                        Custo
                      </app-th-sort>
                    </th>
                    <th class="text-right">% do custo</th>
                    <th class="text-right">
                      <app-th-sort field="conversions" align="right" [current]="sortKeyNetworks()" [direction]="sortDirNetworks()" (sort)="onSortNetworks($event)">
                        Conversões
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="cpa" align="right" [current]="sortKeyNetworks()" [direction]="sortDirNetworks()" (sort)="onSortNetworks($event)">
                        Custo/conv.
                      </app-th-sort>
                    </th>
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
                      <td colspan="8" class="py-8 text-center text-base-content/60">Nenhuma rede encontrada.</td>
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
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="card-title text-base">Por dispositivo</h2>
                <p class="text-sm text-base-content/70">Mesma leitura: compare a fatia do custo com a fatia das conversões de cada aparelho.</p>
              </div>
              <input
                type="search"
                class="input input-sm w-full sm:w-56"
                placeholder="Filtrar dispositivos…"
                aria-label="Filtrar dispositivos"
                [value]="queryDevices()"
                (input)="queryDevices.set(val($event))"
              />
            </div>
            <app-echart [option]="shareChart(deviceShares())" [height]="220" label="Fatia do custo e das conversões por dispositivo" />
            <div class="overflow-x-auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>
                      <app-th-sort field="device" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        Dispositivo
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="impressions" align="right" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        Impressões
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="clicks" align="right" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        Cliques
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="ctr" align="right" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        CTR
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="cpc" align="right" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        CPC
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="cost" align="right" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        Custo
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="conversions" align="right" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        Conversões
                      </app-th-sort>
                    </th>
                    <th class="text-right">
                      <app-th-sort field="cpa" align="right" [current]="sortKeyDevices()" [direction]="sortDirDevices()" (sort)="onSortDevices($event)">
                        Custo/conv.
                      </app-th-sort>
                    </th>
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
                      <td colspan="8" class="py-8 text-center text-base-content/60">Nenhum dispositivo encontrado.</td>
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

  protected readonly queryNetworks = signal('');
  protected readonly sortKeyNetworks = signal<string>('cost');
  protected readonly sortDirNetworks = signal<SortDirection>('desc');

  protected readonly queryDevices = signal('');
  protected readonly sortKeyDevices = signal<string>('cost');
  protected readonly sortDirDevices = signal<SortDirection>('desc');

  protected readonly networks = computed(() => {
    const q = this.queryNetworks().toLowerCase().trim();
    const key = this.sortKeyNetworks();
    const dir = this.sortDirNetworks();

    const list = (this.ws.networks.value() ?? []).filter((n) => !q || n.label.toLowerCase().includes(q));

    return list.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'label':
          cmp = a.label.localeCompare(b.label, 'pt-BR');
          break;
        case 'impressions':
          cmp = a.impressions - b.impressions;
          break;
        case 'clicks':
          cmp = a.clicks - b.clicks;
          break;
        case 'ctr':
          cmp = this.ratioCtr(a) - this.ratioCtr(b);
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

  protected readonly devices = computed(() => {
    const q = this.queryDevices().toLowerCase().trim();
    const key = this.sortKeyDevices();
    const dir = this.sortDirDevices();

    const list = (this.ws.devices.value() ?? []).filter((d) => !q || this.label(d.device).toLowerCase().includes(q));

    return list.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'device':
          cmp = this.label(a.device).localeCompare(this.label(b.device), 'pt-BR');
          break;
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

  protected readonly networkCost = computed(() => (this.ws.networks.value() ?? []).reduce((s, n) => s + n.cost, 0));

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

  protected onSortNetworks(e: { field: string; direction: SortDirection }): void {
    this.sortKeyNetworks.set(e.field);
    this.sortDirNetworks.set(e.direction);
  }

  protected onSortDevices(e: { field: string; direction: SortDirection }): void {
    this.sortKeyDevices.set(e.field);
    this.sortDirDevices.set(e.direction);
  }

  protected val(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected label = deviceLabel;
  protected ratioCtr = (p: Perf): number => ctr(p);
  protected ratioCpc = (p: Perf): number => cpc(p);
  protected share = (part: number, total: number): number => (total > 0 ? part / total : 0);
}
