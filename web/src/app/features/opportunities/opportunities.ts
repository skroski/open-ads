import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChangesStore, HypothesesStore, RecStatesStore } from '../../core/collections';
import { Insights, RecommendationView } from '../../core/insights';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { ChangeEntry, ChangeKind, HypothesisKind, RecommendationCategory, RecommendationStatus } from '../../domain/models';
import {
  OpportunityCategory,
  OpportunityStatus,
  asOpportunity,
} from '../../domain/opportunities';
import { ConfidenceBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { EChart } from '../../shared/echart';
import { EvidenceList } from '../../shared/evidence-list';
import { Icon } from '../../shared/icon';
import { IconName } from '../../shared/icons';
import { ExportData, PageHeader } from '../../shared/page-header';
import type { EChartsCoreOption } from 'echarts/core';

const CATEGORY: Record<OpportunityCategory, { label: string; icon: IconName; help: string }> = {
  ECONOMY: { label: 'Economizar', icon: 'currency', help: 'Despesa com indício mensurável de desperdício.' },
  GROWTH: { label: 'Crescer', icon: 'trend-up', help: 'Alavanca com potencial, que precisa ser acompanhada.' },
  MEASUREMENT: { label: 'Medir melhor', icon: 'target', help: 'Lacuna de medição que reduz a segurança das decisões.' },
  EXPERIMENT: { label: 'Testar', icon: 'beaker', help: 'Hipótese ainda sem confiança suficiente para virar ação definitiva.' },
};

const STATUS: Record<OpportunityStatus, string> = {
  REVIEW: 'A revisar',
  TESTING: 'Plano criado',
  APPLIED: 'Aplicada',
  DISMISSED: 'Descartada',
};

type CategoryFilter = 'ALL' | OpportunityCategory;
type StatusFilter = 'ALL' | OpportunityStatus;

interface OpportunityView {
  recommendation: RecommendationView;
  category: OpportunityCategory;
  status: OpportunityStatus;
}

@Component({
  selector: 'app-opportunities-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, ConfidenceBadge, DataState, EChart, EvidenceList, Icon, PageHeader],
  template: `
    <app-page-header
      group="Inteligência"
      title="Central de oportunidades"
      subtitle="Uma fila única para economizar, crescer, corrigir a medição e testar hipóteses. Cada item preserva sua evidência; nenhuma alteração é enviada ao Google Ads daqui."
      [exportData]="exportData()"
    />

    <app-data-state
      [loading]="insights.loadingCore()"
      [error]="insights.coreError()"
      [hasData]="!!insights.funnel()"
      (retry)="ws.reloadAll()"
    >
      <div class="flex flex-col gap-block">
        <div class="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal">
          @for (item of categories; track item.key) {
            <div class="stat">
              <div class="stat-figure text-base-content/50"><app-icon [name]="item.icon" /></div>
              <div class="stat-title">{{ item.label }}</div>
              <div class="stat-value text-2xl">{{ countCategory(item.key) }}</div>
              <div class="stat-desc">{{ item.help }}</div>
            </div>
          }
        </div>

        @if (opportunityChart(); as chart) {
          <section class="card card-border bg-base-100">
            <div class="card-body gap-3 p-4 sm:p-6">
              <div><h2 class="text-base font-semibold">Mapa da fila de decisão</h2><p class="text-sm text-base-content/70">Quantidade de oportunidades por frente e situação. É uma visão de gestão da fila, não soma economia ou receita entre recomendações sobrepostas.</p></div>
              <app-echart [option]="chart" [height]="270" label="Oportunidades por frente e situação" />
            </div>
          </section>
        }

        <section class="card card-border bg-base-100">
          <div class="card-body gap-4 p-4 sm:p-6">
            <div class="flex flex-wrap items-center gap-2">
              <select class="select select-sm" aria-label="Tipo de oportunidade" [value]="category()" (change)="category.set(value($event))">
                <option value="ALL">Todos os tipos</option>
                @for (item of categories; track item.key) {
                  <option [value]="item.key">{{ item.label }}</option>
                }
              </select>
              <select class="select select-sm" aria-label="Situação" [value]="status()" (change)="status.set(value($event))">
                <option value="ALL">Todas as situações</option>
                @for (item of statuses; track item.key) {
                  <option [value]="item.key">{{ item.label }}</option>
                }
              </select>
              <span class="ml-auto text-sm text-base-content/60">{{ visible().length }} oportunidades</span>
            </div>

            <ul class="flex flex-col gap-3">
              @for (item of visible(); track item.recommendation.id) {
                @let r = item.recommendation;
                <li class="rounded-box border border-base-300 p-4 sm:p-5">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="badge badge-soft gap-1"><app-icon [name]="categoryInfo(item.category).icon" size="xs" /> {{ categoryInfo(item.category).label }}</span>
                        <span class="badge badge-ghost">{{ statusLabel(item.status) }}</span>
                        <app-confidence [level]="r.confidence.level" />
                        @if (r.impact.monthlyCostBrl; as impact) {
                          <span class="badge badge-ghost">até {{ impact | currency: 'BRL' : 'symbol' : '1.0-0' }}/mês em revisão</span>
                        }
                      </div>
                      <h2 class="mt-3 text-base font-semibold">{{ r.title }}</h2>
                      <p class="mt-1 text-sm text-base-content/75">{{ r.problem }}</p>
                    </div>
                    <div class="flex shrink-0 flex-wrap gap-2">
                      @if (item.status === 'REVIEW') {
                        <button type="button" class="btn btn-sm" (click)="createTest(r)"><app-icon name="beaker" size="sm" /> Criar plano de teste</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="discard(r)">Descartar</button>
                      } @else if (item.status === 'TESTING') {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="openExperiments()">Ver experimento</button>
                        <button type="button" class="btn btn-sm" (click)="markApplied(r)">Marcar aplicada</button>
                      } @else {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="reopen(r)">Reabrir</button>
                      }
                    </div>
                  </div>

                  <div class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div><div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Próximo passo</div><p>{{ r.action }}</p></div>
                    <div><div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Como validar</div><p>{{ r.validation }}</p></div>
                  </div>

                  <details class="collapse collapse-arrow mt-4 rounded-box border border-base-300 bg-base-200/40">
                    <summary class="collapse-title min-h-0 py-2 text-sm font-medium">Evidências e limites</summary>
                    <div class="collapse-content flex flex-col gap-3 text-sm">
                      <app-evidence-list [items]="r.evidence" />
                      <p><strong>Base:</strong> {{ r.impact.basis }}</p>
                      <p class="text-base-content/65">“Em revisão” não equivale a economia ou receita garantida. O resultado precisa ser medido após a mudança.</p>
                    </div>
                  </details>
                </li>
              } @empty {
                <li class="rounded-box border border-dashed border-base-300 p-8 text-center text-sm text-base-content/65">Nenhuma oportunidade com estes filtros. Atualize os dados ou reveja as configurações de meta e medição.</li>
              }
            </ul>
          </div>
        </section>
      </div>
    </app-data-state>
  `,
})
export class OpportunitiesPage {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  private readonly states = inject(RecStatesStore);
  private readonly hypotheses = inject(HypothesesStore);
  private readonly changes = inject(ChangesStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly category = signal<CategoryFilter>('ALL');
  protected readonly status = signal<StatusFilter>('ALL');
  protected readonly categories = (Object.keys(CATEGORY) as OpportunityCategory[]).map((key) => ({ key, ...CATEGORY[key] }));
  protected readonly statuses = (Object.keys(STATUS) as OpportunityStatus[]).map((key) => ({ key, label: STATUS[key] }));

  protected readonly all = computed<OpportunityView[]>(() =>
    this.insights.recommendations().map((recommendation) => {
      const mapped = asOpportunity({
        category: recommendation.category,
        status: recommendation.status,
        priority: recommendation.priority,
        confidence: recommendation.confidence.level,
      });
      return { recommendation, category: mapped.category, status: mapped.status };
    }),
  );

  protected readonly visible = computed(() => {
    const category = this.category();
    const status = this.status();
    return this.all()
      .filter((item) => (category === 'ALL' || item.category === category) && (status === 'ALL' || item.status === status))
      .sort((a, b) => b.recommendation.priority - a.recommendation.priority);
  });

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'oportunidades',
    rows: this.all().map((item) => ({
      Oportunidade: item.recommendation.title,
      Frente: CATEGORY[item.category].label,
      Situação: STATUS[item.status],
      Confiança: { HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' }[item.recommendation.confidence.level],
      'Gasto mensal em revisão (R$)': item.recommendation.impact.monthlyCostBrl ?? '',
      'Como validar': item.recommendation.validation,
    })),
  }));
  protected readonly opportunityChart = computed<EChartsCoreOption | null>(() => {
    const rows = this.all();
    if (!rows.length) return null;
    const categories = Object.keys(CATEGORY) as OpportunityCategory[];
    const statuses: OpportunityStatus[] = ['REVIEW', 'TESTING', 'APPLIED', 'DISMISSED'];
    const colors = ['#f1a10b', '#3d7ea6', '#5c9c2f', '#9a9a9a'];
    return {
      color: colors,
      grid: { left: 44, right: 20, top: 38, bottom: 50 },
      legend: { data: statuses.map((status) => STATUS[status]) },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: categories.map((category) => CATEGORY[category].label) },
      yAxis: { type: 'value', minInterval: 1 },
      series: statuses.map((status) => ({
        type: 'bar' as const,
        name: STATUS[status],
        stack: 'fila',
        data: categories.map((category) => rows.filter((row) => row.category === category && row.status === status).length),
        barMaxWidth: 48,
      })),
    };
  });

  constructor() {
    this.insights.needCore();
  }

  protected countCategory(category: OpportunityCategory): number {
    return this.all().filter((item) => item.category === category && item.status !== 'DISMISSED').length;
  }

  protected categoryInfo(category: OpportunityCategory): (typeof CATEGORY)[OpportunityCategory] {
    return CATEGORY[category];
  }

  protected statusLabel(status: OpportunityStatus): string {
    return STATUS[status];
  }

  protected value(event: Event): never {
    return (event.target as HTMLSelectElement).value as never;
  }

  protected async createTest(r: RecommendationView): Promise<void> {
    const kind: HypothesisKind = r.category === 'LANDING_PAGE' ? 'LANDING_URL' : r.category === 'CONTENT' ? 'CONTENT' : r.category === 'CAMPAIGN' ? 'BID' : 'OTHER';
    await this.hypotheses.add({
      createdAt: new Date().toISOString(),
      kind,
      title: `Validar: ${r.title}`,
      statement: `Se executarmos “${r.action}”, esperamos melhorar o resultado definido para esta oportunidade, porque ${r.problem.toLowerCase()}`,
      campaignId: r.entity?.type === 'campaign' ? r.entity.id : undefined,
      method: 'EXPERIMENT',
      status: 'DRAFT',
      minLiftPct: 10,
    });
    await this.states.setStatus(r.id, 'ACCEPTED');
    this.toast.success('Plano criado localmente. Revise o desenho antes de alterar a conta de anúncios.');
    void this.router.navigate(['/experimentos']);
  }

  protected async discard(r: RecommendationView): Promise<void> {
    await this.states.setStatus(r.id, 'DISMISSED');
  }

  protected async markApplied(r: RecommendationView): Promise<void> {
    await this.states.setStatus(r.id, 'DONE');
    const kind: ChangeKind = r.category === 'TRACKING' ? 'TRACKING' : r.category === 'CONTENT' ? 'CONTENT' : r.category === 'LANDING_PAGE' ? 'URL' : r.category === 'CAMPAIGN' ? 'CAMPAIGN' : 'OTHER';
    await this.changes.add({
      at: new Date().toISOString().slice(0, 19), kind, title: r.title, description: r.action,
      source: 'MANUAL', entity: r.entity, campaignId: r.entity?.type === 'campaign' ? r.entity.id : undefined,
      expected: r.validation, externalKey: `opportunity:${r.id}:${new Date().toISOString().slice(0, 10)}`,
    } as Omit<ChangeEntry, 'id' | 'accountId'>);
    this.toast.success('Marcada como aplicada e registrada na Auditoria para medir o efeito.');
  }

  protected async reopen(r: RecommendationView): Promise<void> {
    await this.states.setStatus(r.id, 'OPEN');
  }

  protected openExperiments(): void {
    void this.router.navigate(['/experimentos']);
  }
}
