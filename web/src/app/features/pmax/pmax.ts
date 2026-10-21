import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Workspace } from '../../core/workspace';
import { DataState } from '../../shared/data-state';
import { EChart } from '../../shared/echart';
import { Icon } from '../../shared/icon';
import { ExportData, PageHeader } from '../../shared/page-header';
import type { EChartsCoreOption } from 'echarts/core';

const strengthLabel = (value: string): string => ({
  EXCELLENT: 'Excelente', GOOD: 'Boa', AVERAGE: 'Média', POOR: 'Baixa', NO_ADS: 'Sem anúncios', PENDING: 'Pendente',
} as Record<string, string>)[value] ?? (value || 'Não informado');

const strengthClass = (value: string): string => {
  const tone = value === 'EXCELLENT' || value === 'GOOD' ? 'badge-success' : value === 'AVERAGE' ? 'badge-warning' : value === 'POOR' ? 'badge-error' : 'badge-ghost';
  return `badge badge-soft badge-sm ${tone}`;
};

const fieldLabel = (value: string): string => ({
  HEADLINE: 'Título', LONG_HEADLINE: 'Título longo', DESCRIPTION: 'Descrição', MARKETING_IMAGE: 'Imagem', SQUARE_MARKETING_IMAGE: 'Imagem quadrada',
  LOGO: 'Logotipo', YOUTUBE_VIDEO: 'Vídeo', BUSINESS_NAME: 'Nome da empresa', CALL_TO_ACTION_SELECTION: 'Chamada para ação',
} as Record<string, string>)[value] ?? (value || 'Outro recurso');

interface AssetSummary {
  fieldType: string;
  count: number;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  limited: number;
}

@Component({
  selector: 'app-pmax-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, DataState, EChart, Icon, PageHeader],
  template: `
    <app-page-header
      group="Operação no Google Ads"
      title="Radar Performance Max"
      subtitle="Leia a saúde dos grupos de recursos e o desempenho observado no período. A API não transforma a métrica de um recurso em prova causal: use o radar para decidir o próximo teste."
      [exportData]="exportData()"
    />

    <app-data-state [loading]="ws.pmaxAssetGroups.loading() || ws.pmaxAssets.loading()" [error]="ws.pmaxAssetGroups.error() ?? ws.pmaxAssets.error()" [hasData]="ws.pmaxAssetGroups.value() !== undefined" (retry)="reload()">
      @if (!groups().length) {
        <section class="card card-border bg-base-100"><div class="card-body items-start gap-3"><app-icon name="chart" class="text-base-content/50" /><h2 class="text-base font-semibold">Nenhum grupo de recursos Performance Max encontrado</h2><p class="text-sm text-base-content/70">Este diagnóstico aparece quando a conta tiver campanhas Performance Max com grupos de recursos visíveis à integração.</p></div></section>
      } @else {
        <div class="flex flex-col gap-block">
          <div class="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal">
            <div class="stat"><div class="stat-title">Grupos de recursos</div><div class="stat-value text-2xl">{{ groups().length }}</div><div class="stat-desc">em {{ campaignCount() }} campanhas</div></div>
            <div class="stat"><div class="stat-title">Recursos com status limitado</div><div class="stat-value text-2xl">{{ limitedAssets() }}</div><div class="stat-desc">verifique política ou elegibilidade</div></div>
            <div class="stat"><div class="stat-title">Investimento observado</div><div class="stat-value text-2xl">{{ totalCost() | currency: 'BRL' : 'symbol' : '1.0-0' }}</div><div class="stat-desc">período selecionado</div></div>
          </div>

          @if (groupPerformanceChart(); as chart) {
            <section class="card card-border bg-base-100"><div class="card-body gap-3 p-4 sm:p-6">
              <div><h2 class="text-base font-semibold">Investimento e conversões por grupo</h2><p class="text-sm text-base-content/70">Métricas observadas no período selecionado, ordenadas por investimento. Use para escolher onde investigar; não atribui resultado a um recurso isolado.</p></div>
              <app-echart [option]="chart" [height]="300" label="Custo e conversões observados por grupo de recursos Performance Max" />
            </div></section>
          }

          @if (assetCompositionChart(); as chart) {
            <section class="card card-border bg-base-100"><div class="card-body gap-3 p-4 sm:p-6">
              <div><h2 class="text-base font-semibold">Cobertura por tipo de recurso</h2><p class="text-sm text-base-content/70">Contagem do inventário lido pela API. “Limitados” aponta recursos cujo status principal não está elegível.</p></div>
              <app-echart [option]="chart" [height]="280" label="Recursos e recursos limitados por tipo em Performance Max" />
            </div></section>
          }

          <section class="card card-border bg-base-100"><div class="card-body gap-4 p-4 sm:p-6">
            <div><h2 class="text-base font-semibold">Grupos de recursos</h2><p class="text-sm text-base-content/70">Força do anúncio e cobertura vêm do Google Ads; custo e conversões são métricas observadas do grupo no período.</p></div>
            <div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>Campanha / grupo</th><th>Força</th><th>Cobertura</th><th>Status</th><th class="text-right">Custo</th><th class="text-right">Conv.</th><th class="text-right">CPA observado</th></tr></thead><tbody>
              @for (g of groups(); track g.id) { <tr class="hover:bg-base-200/60"><td><div class="font-medium">{{ g.name || 'Grupo sem nome' }}</div><div class="text-xs text-base-content/60">{{ g.campaignName }}</div></td><td><span [class]="strengthClass(g.adStrength)">{{ strengthLabel(g.adStrength) }}</span></td><td class="text-sm">{{ g.assetCoverage || 'Não informado' }}</td><td class="text-sm">{{ g.primaryStatus || 'Não informado' }}</td><td class="tabular text-right">{{ g.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td><td class="tabular text-right">{{ g.conversions | number: '1.0-1' }}</td><td class="tabular text-right">@if (g.conversions > 0) { {{ g.cost / g.conversions | currency: 'BRL' : 'symbol' : '1.2-2' }} } @else { — }</td></tr> }
            </tbody></table></div>
          </div></section>

          <section class="card card-border bg-base-100"><div class="card-body gap-4 p-4 sm:p-6">
            <div><h2 class="text-base font-semibold">Composição dos recursos</h2><p class="text-sm text-base-content/70">Agrupado por tipo de recurso. Isso ajuda a encontrar lacunas de formato, não prova que um texto ou imagem causou uma conversão.</p></div>
            <div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>Tipo</th><th class="text-right">Recursos</th><th class="text-right">Limitados</th><th class="text-right">Impressões</th><th class="text-right">Cliques</th><th class="text-right">Custo observado</th></tr></thead><tbody>
              @for (row of assetSummary(); track row.fieldType) { <tr class="hover:bg-base-200/60"><td class="font-medium">{{ fieldLabel(row.fieldType) }}</td><td class="tabular text-right">{{ row.count }}</td><td class="tabular text-right">{{ row.limited }}</td><td class="tabular text-right">{{ row.impressions | number: '1.0-0' }}</td><td class="tabular text-right">{{ row.clicks | number: '1.0-0' }}</td><td class="tabular text-right">{{ row.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td></tr> }
            </tbody></table></div>
          </div></section>

          <div role="note" class="alert alert-soft text-sm"><app-icon name="info" /><span>Para mudar recursos, orçamento, segmentação ou lances, crie primeiro uma hipótese no Laboratório e registre a alteração na Auditoria. Este radar é somente leitura.</span></div>
        </div>
      }
    </app-data-state>
  `,
})
export class PmaxPage {
  protected readonly ws = inject(Workspace);
  protected readonly groups = computed(() => [...(this.ws.pmaxAssetGroups.value() ?? [])].sort((a, b) => b.cost - a.cost));
  private readonly assets = computed(() => this.ws.pmaxAssets.value() ?? []);
  protected readonly campaignCount = computed(() => new Set(this.groups().map((g) => g.campaignId)).size);
  protected readonly totalCost = computed(() => this.groups().reduce((sum, g) => sum + g.cost, 0));
  protected readonly assetSummary = computed<AssetSummary[]>(() => {
    const byType = new Map<string, AssetSummary>();
    for (const row of this.assets()) {
      const current = byType.get(row.fieldType) ?? { fieldType: row.fieldType, count: 0, impressions: 0, clicks: 0, cost: 0, conversions: 0, limited: 0 };
      current.count++; current.impressions += row.impressions; current.clicks += row.clicks; current.cost += row.cost; current.conversions += row.conversions;
      if (row.primaryStatus && row.primaryStatus !== 'ELIGIBLE') current.limited++;
      byType.set(row.fieldType, current);
    }
    return [...byType.values()].sort((a, b) => b.cost - a.cost || a.fieldType.localeCompare(b.fieldType));
  });
  protected readonly limitedAssets = computed(() => this.assetSummary().reduce((sum, item) => sum + item.limited, 0));
  protected readonly groupPerformanceChart = computed<EChartsCoreOption | null>(() => {
    const rows = this.groups().slice(0, 12).reverse();
    if (!rows.length) return null;
    return {
      color: ['#f1a10b', '#3d7ea6'],
      grid: { left: 64, right: 56, top: 36, bottom: 76 },
      legend: { data: ['Custo observado', 'Conversões observadas'] },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: rows.map((g) => g.name || g.campaignName), axisLabel: { rotate: 28, interval: 0 } },
      yAxis: [
        { type: 'value', name: 'Custo (R$)', axisLabel: { formatter: (value: number) => `R$ ${Math.round(value)}` } },
        { type: 'value', name: 'Conversões', minInterval: 1 },
      ],
      series: [
        { type: 'bar', name: 'Custo observado', data: rows.map((g) => Math.round(g.cost * 100) / 100), barMaxWidth: 32 },
        { type: 'line', name: 'Conversões observadas', yAxisIndex: 1, data: rows.map((g) => Math.round(g.conversions * 10) / 10), smooth: true },
      ],
    };
  });
  protected readonly assetCompositionChart = computed<EChartsCoreOption | null>(() => {
    const rows = this.assetSummary().slice(0, 10).reverse();
    if (!rows.length) return null;
    return {
      color: ['#3d7ea6', '#c0392b'],
      grid: { left: 136, right: 24, top: 36, bottom: 24 },
      legend: { data: ['Recursos', 'Limitados'] },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: rows.map((row) => fieldLabel(row.fieldType)) },
      series: [
        { type: 'bar', name: 'Recursos', data: rows.map((row) => row.count), barMaxWidth: 24 },
        { type: 'bar', name: 'Limitados', data: rows.map((row) => row.limited), barMaxWidth: 24 },
      ],
    };
  });
  protected readonly exportData = computed<ExportData>(() => ({
    name: 'radar-performance-max',
    rows: this.groups().map((g) => ({ Campanha: g.campaignName, Grupo: g.name, 'Força do anúncio': strengthLabel(g.adStrength), Cobertura: g.assetCoverage, Status: g.primaryStatus, 'Custo (R$)': Math.round(g.cost * 100) / 100, Conversões: g.conversions })),
  }));

  constructor() { this.ws.pmaxAssetGroups.need(); this.ws.pmaxAssets.need(); }
  protected strengthLabel = strengthLabel;
  protected strengthClass = strengthClass;
  protected fieldLabel = fieldLabel;
  protected reload(): void { this.ws.pmaxAssetGroups.reload(); this.ws.pmaxAssets.reload(); }
}
