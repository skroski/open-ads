import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { FormField, FormRoot, form, max, min } from '@angular/forms/signals';
import { BusinessConfigStore } from '../../core/business-config.store';
import { Insights } from '../../core/insights';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { days, num } from '../../domain/format';
import { evaluateGoal } from '../../domain/funnel';
import { FunnelStage, STAGE_HELP, STAGE_LABEL } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { FunnelBars } from '../../shared/funnel-bars';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { LeadsPanel } from './leads';

type GoalStage = Exclude<FunnelStage, 'CLICK'>;

const GOAL_STAGES: ReadonlyArray<{ value: GoalStage; label: string }> = [
  { value: 'INTERACTION', label: 'Interação (clique no WhatsApp, telefone…)' },
  { value: 'CONTACT', label: 'Contato iniciado' },
  { value: 'QUALIFIED', label: 'Lead qualificado' },
  { value: 'PROPOSAL', label: 'Proposta enviada' },
  { value: 'SALE', label: 'Venda' },
];

const MAPPING_STAGES: ReadonlyArray<{ value: FunnelStage | 'IGNORE'; label: string }> = [
  { value: 'INTERACTION', label: 'Interação' },
  { value: 'CONTACT', label: 'Contato iniciado' },
  { value: 'QUALIFIED', label: 'Lead qualificado' },
  { value: 'PROPOSAL', label: 'Proposta' },
  { value: 'SALE', label: 'Venda' },
  { value: 'IGNORE', label: 'Ignorar (não contar)' },
];

@Component({
  selector: 'app-funnel-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    PercentPipe,
    DataState,
    FormField,
    FormRoot,
    FunnelBars,
    Icon,
    LeadsPanel,
    PageHeader,
  ],
  template: `
    <app-page-header
      group="Inteligência"
      title="Qualidade do funil"
      subtitle="Separe clique, interação, contato, lead qualificado, proposta e venda. Só o que vem do CRM vira receita e ROI."
    />

    <div class="flex flex-col gap-block">
      <app-data-state
        [loading]="insights.loadingCore()"
        [error]="insights.coreError()"
        [hasData]="!!f()"
        (retry)="ws.reloadAll()"
      >
        @if (f(); as funnel) {
          <!-- Funil -->
          <section class="card card-border bg-base-100">
            <div class="card-body gap-6">
              <div>
                <h2 class="card-title text-base">Funil do período</h2>
                <p class="text-sm text-base-content/70">
                  {{ goalText() }}
                </p>
              </div>

              <app-funnel-bars [bars]="bars()" />

              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Estágio</th>
                      <th class="text-right">Quantidade</th>
                      <th>Fonte</th>
                      <th class="text-right">Custo por estágio</th>
                      <th class="text-right">Do estágio anterior</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of stageRows(); track r.stage) {
                      <tr class="hover:bg-base-200/60">
                        <td>
                          <div class="font-medium">{{ r.label }}</div>
                          <div class="max-w-md text-xs text-base-content/60">{{ r.help }}</div>
                        </td>
                        <td class="text-right tabular">
                          @if (r.available) {
                            {{ r.count | number: '1.0-1' }}
                            @if (r.ads !== r.crm && r.ads > 0 && r.crm > 0) {
                              <div class="text-xs text-base-content/60">Ads {{ r.ads | number: '1.0-1' }} · CRM {{ r.crm }}</div>
                            }
                          } @else {
                            <span class="text-base-content/40">—</span>
                          }
                        </td>
                        <td>
                          @if (r.available) {
                            <span class="badge badge-soft badge-sm">{{ r.source }}</span>
                          } @else {
                            <span class="badge badge-dash badge-sm">indisponível</span>
                          }
                        </td>
                        <td class="text-right tabular">
                          @if (r.costPer !== null) {
                            {{ r.costPer | currency: 'BRL' : 'symbol' : '1.2-2' }}
                          } @else {
                            <span class="text-base-content/40">—</span>
                          }
                        </td>
                        <td class="text-right tabular">
                          @if (r.rate !== null) {
                            {{ r.rate | percent: '1.0-1' }}
                          } @else {
                            <span class="text-base-content/40">—</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div class="stats stats-vertical w-full border border-base-300 sm:stats-horizontal">
                <div class="stat py-3">
                  <div class="stat-title">Receita (CRM)</div>
                  <div class="stat-value text-xl">
                    @if (funnel.total.revenue !== null) {
                      {{ funnel.total.revenue | currency: 'BRL' : 'symbol' : '1.2-2' }}
                    } @else {
                      <span class="text-base-content/40">—</span>
                    }
                  </div>
                  <div class="stat-desc">
                    @if (funnel.total.revenue === null) {
                      Sem leads do CRM no período
                    } @else if (funnel.total.salesWithoutValue > 0) {
                      {{ funnel.total.salesWithoutValue }} venda(s) sem valor: ROI não calculado
                    } @else {
                      Somente vendas registradas
                    }
                  </div>
                </div>
                <div class="stat py-3">
                  <div class="stat-title">ROI</div>
                  <div class="stat-value text-xl">
                    @if (funnel.total.roi !== null) {
                      {{ funnel.total.roi | percent: '1.0-0' }}
                    } @else {
                      <span class="text-base-content/40">—</span>
                    }
                  </div>
                  <div class="stat-desc">(receita − investimento) ÷ investimento</div>
                </div>
                <div class="stat py-3">
                  <div class="stat-title">ROI sobre a margem</div>
                  <div class="stat-value text-xl">
                    @if (funnel.total.roiOnMargin !== null) {
                      {{ funnel.total.roiOnMargin | percent: '1.0-0' }}
                    } @else {
                      <span class="text-base-content/40">—</span>
                    }
                  </div>
                  <div class="stat-desc">
                    @if (funnel.total.roiOnMargin !== null) {
                      Lucro bruto {{ funnel.total.grossProfit | currency: 'BRL' : 'symbol' : '1.2-2' }}
                    } @else {
                      Informe a margem para calcular
                    }
                  </div>
                </div>
                <div class="stat py-3">
                  <div class="stat-title">Valor do Google Ads</div>
                  <div class="stat-value text-xl">{{ funnel.adsValue.total | currency: 'BRL' : 'symbol' : '1.2-2' }}</div>
                  <div class="stat-desc">
                    @if (funnel.adsValue.isStatic) {
                      Valor fixo por conversão, não é receita
                    } @else {
                      Valor atribuído às conversões, não confirmado
                    }
                  </div>
                </div>
              </div>

              @if (insights.maturity() < 1) {
                <div role="note" class="alert alert-soft alert-info">
                  <app-icon name="clock" />
                  <span class="text-sm">
                    {{ insights.maturity() | percent: '1.0-0' }} do período teve tempo de gerar
                    {{ goalLabel() }} (prazo típico de {{ lagText() }}). Estágios finais ainda estão amadurecendo.
                  </span>
                </div>
              }
            </div>
          </section>

          <!-- Meta do negócio -->
          <section class="card card-border bg-base-100">
            <div class="card-body gap-4">
              <div>
                <h2 class="card-title text-base"><app-icon name="target" size="sm" /> O que é um bom resultado para o seu negócio</h2>
                <p class="text-sm text-base-content/70">
                  A régua do painel. Sem ela, comparamos cada linha com a média da própria conta.
                </p>
              </div>

              <form [formRoot]="goalForm" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">Resultado que importa</legend>
                  <select class="select w-full" [formField]="goalForm.stage">
                    @for (s of goalStages; track s.value) {
                      <option [value]="s.value">{{ s.label }}</option>
                    }
                  </select>
                </fieldset>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">Custo máximo por resultado (R$)</legend>
                  <input type="number" step="0.5" class="input w-full" [formField]="goalForm.target" />
                  <p class="label whitespace-normal">0 = sem meta</p>
                </fieldset>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">Custo máximo por cliente (R$)</legend>
                  <input type="number" step="1" class="input w-full" [formField]="goalForm.cac" />
                  <p class="label whitespace-normal">0 = sem meta</p>
                </fieldset>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">ROI mínimo (%)</legend>
                  <input type="number" class="input w-full" [formField]="goalForm.roi" />
                  <p class="label whitespace-normal">100 = ganhar o dobro do investido</p>
                </fieldset>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">Margem padrão (%)</legend>
                  <input type="number" class="input w-full" [formField]="goalForm.margin" />
                  @if (goalForm.margin().touched() && goalForm.margin().errors().length) {
                    <p class="label text-error">{{ goalForm.margin().errors()[0].message }}</p>
                  } @else {
                    <p class="label whitespace-normal">Usada quando a venda não informa a própria margem</p>
                  }
                </fieldset>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">Ciclo de venda (dias)</legend>
                  <input type="number" class="input w-full" [formField]="goalForm.cycle" />
                  <p class="label whitespace-normal">Do primeiro contato até fechar. Evita cortes precipitados.</p>
                </fieldset>
                <div class="sm:col-span-2 lg:col-span-3">
                  <button type="submit" class="btn btn-sm">Salvar meta</button>
                </div>
              </form>

              @if (goalResult(); as g) {
                <div class="rounded-box bg-base-200 p-3 text-sm">
                  <strong>Hoje:</strong>
                  @switch (g.status) {
                    @case ('MET') {
                      {{ goalLabel() }} a {{ g.costPerGoal | currency: 'BRL' : 'symbol' : '1.2-2' }}: dentro da meta de
                      {{ g.target | currency: 'BRL' : 'symbol' : '1.2-2' }}.
                    }
                    @case ('ABOVE') {
                      {{ goalLabel() }} a {{ g.costPerGoal | currency: 'BRL' : 'symbol' : '1.2-2' }}: acima da meta de
                      {{ g.target | currency: 'BRL' : 'symbol' : '1.2-2' }}.
                    }
                    @case ('NO_TARGET') {
                      {{ goalLabel() }} a {{ g.costPerGoal | currency: 'BRL' : 'symbol' : '1.2-2' }}. Defina uma meta para
                      saber se é bom.
                    }
                    @case ('NO_RESULTS') {
                      Nenhum {{ goalLabel() }} no período.
                    }
                    @default {
                      Ainda não há fonte de dados para {{ goalLabel() }}. Importe os leads do CRM abaixo.
                    }
                  }
                </div>
              }
            </div>
          </section>

          <!-- Mapeamento das conversões -->
          <section class="card card-border bg-base-100">
            <div class="card-body gap-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="card-title text-base"><app-icon name="tag" size="sm" /> O que cada conversão do Google Ads significa</h2>
                  <p class="max-w-3xl text-sm text-base-content/70">
                    Um clique no WhatsApp não é um contato, e um contato não é um lead qualificado. Diga em que
                    estágio cada ação se encaixa. As sugestões automáticas usam o nome e a categoria da ação.
                  </p>
                </div>
                @if (unconfirmed() > 0) {
                  <button type="button" class="btn btn-sm" (click)="confirmAll()">
                    <app-icon name="check" size="sm" /> Confirmar as sugestões
                  </button>
                }
              </div>

              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Ação de conversão</th>
                      <th class="text-right">Conversões</th>
                      <th class="text-right">Valor no Ads</th>
                      <th>Conta como</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (a of funnel.resolutions; track a.name) {
                      <tr class="hover:bg-base-200/60">
                        <td>
                          <div class="font-medium">{{ a.name }}</div>
                          <div class="text-xs text-base-content/60">{{ a.category }}</div>
                        </td>
                        <td class="text-right tabular">{{ a.allConversions | number: '1.0-1' }}</td>
                        <td class="text-right tabular">
                          {{ a.value | currency: 'BRL' : 'symbol' : '1.2-2' }}
                          @if (funnel.adsValue.isStatic) {
                            <div class="text-xs text-warning">valor fixo</div>
                          }
                        </td>
                        <td>
                          <select
                            class="select select-sm"
                            [attr.aria-label]="'Estágio de ' + a.name"
                            (change)="setStage(a.name, $event)"
                          >
                            @for (s of mappingStages; track s.value) {
                              <option [value]="s.value" [selected]="a.stage === s.value">{{ s.label }}</option>
                            }
                          </select>
                        </td>
                        <td>
                          @if (a.confirmed) {
                            <span class="badge badge-soft badge-success badge-sm">confirmado</span>
                          } @else {
                            <span class="badge badge-soft badge-warning badge-sm">sugerido</span>
                          }
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="5" class="py-8 text-center text-base-content/60">
                          Nenhuma conversão registrada neste período.
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <!-- Por campanha -->
          <section class="card card-border bg-base-100">
            <div class="card-body gap-4">
              <h2 class="card-title text-base"><app-icon name="folder" size="sm" /> Por campanha</h2>
              <p class="text-sm text-base-content/70">
                Leads do CRM são ligados à campanha pelo nome ou pelo id. Leads sem origem
                ({{ funnel.unattributedLeads }}) entram só no total.
              </p>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Campanha</th>
                      <th class="text-right">Custo</th>
                      <th class="text-right">Cliques</th>
                      <th class="text-right">Contatos</th>
                      <th class="text-right">Qualificados</th>
                      <th class="text-right">Vendas</th>
                      <th class="text-right">Receita</th>
                      <th class="text-right">Custo/qualificado</th>
                      <th class="text-right">CAC</th>
                      <th class="text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of campaignRows(); track c.id) {
                      <tr class="hover:bg-base-200/60">
                        <td class="max-w-64">
                          <div class="font-medium break-words">{{ c.name }}</div>
                        </td>
                        <td class="text-right tabular">{{ c.m.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                        <td class="text-right tabular">{{ c.m.clicks | number: '1.0-0' }}</td>
                        <td class="text-right tabular">{{ cellCount(c.m.stages.CONTACT) }}</td>
                        <td class="text-right tabular">{{ cellCount(c.m.stages.QUALIFIED) }}</td>
                        <td class="text-right tabular">{{ cellCount(c.m.stages.SALE) }}</td>
                        <td class="text-right tabular">
                          @if (c.m.revenue !== null) {
                            {{ c.m.revenue | currency: 'BRL' : 'symbol' : '1.0-0' }}
                          } @else {
                            <span class="text-base-content/40">—</span>
                          }
                        </td>
                        <td class="text-right tabular">
                          @if (c.m.costPer.QUALIFIED !== null) {
                            {{ c.m.costPer.QUALIFIED | currency: 'BRL' : 'symbol' : '1.2-2' }}
                          } @else {
                            <span class="text-base-content/40">—</span>
                          }
                        </td>
                        <td class="text-right tabular">
                          @if (c.m.costPer.SALE !== null) {
                            {{ c.m.costPer.SALE | currency: 'BRL' : 'symbol' : '1.2-2' }}
                          } @else {
                            <span class="text-base-content/40">—</span>
                          }
                        </td>
                        <td class="text-right tabular">
                          @if (c.m.roi !== null) {
                            {{ c.m.roi | percent: '1.0-0' }}
                          } @else {
                            <span class="text-base-content/40">—</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        }
      </app-data-state>

      <app-leads-panel />
    </div>
  `,
})
export class FunnelPage {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly toast = inject(ToastService);

  protected readonly goalStages = GOAL_STAGES;
  protected readonly mappingStages = MAPPING_STAGES;
  protected readonly f = this.insights.funnel;

  protected readonly goalLabel = computed(() => STAGE_LABEL[this.cfg.config().goal.goalStage].toLowerCase());
  protected readonly lagText = computed(() => days(this.insights.goalLagDays()));

  protected readonly goalText = computed(() => {
    const g = this.cfg.config().goal;
    return `Meta atual: ${STAGE_LABEL[g.goalStage].toLowerCase()}${
      g.targetCostPerGoal ? ` a até R$ ${g.targetCostPerGoal.toFixed(2).replace('.', ',')} cada` : ' (sem valor máximo definido)'
    }.`;
  });

  protected readonly bars = computed(() => {
    const f = this.f();
    return f
      ? this.insights.stageOrder.map((stage) => ({
          stage,
          count: f.total.stages[stage].count,
          source: f.total.stages[stage].source,
        }))
      : [];
  });

  protected readonly stageRows = computed(() => {
    const f = this.f();
    if (!f) return [];
    let previous: number | null = null;
    return this.insights.stageOrder.map((stage) => {
      const v = f.total.stages[stage];
      const available = v.source !== 'NONE';
      const rate = available && previous !== null && previous > 0 ? v.count / previous : null;
      if (available) previous = v.count;
      return {
        stage,
        label: STAGE_LABEL[stage],
        help: STAGE_HELP[stage],
        count: v.count,
        ads: v.ads,
        crm: v.crm,
        available,
        source: v.source === 'ADS' ? 'Google Ads' : 'CRM',
        costPer: f.total.costPer[stage],
        rate,
      };
    });
  });

  protected readonly campaignRows = computed(() => {
    const f = this.f();
    const campaigns = this.ws.campaigns.value() ?? [];
    if (!f) return [];
    return campaigns
      .map((c) => ({ id: c.id, name: c.name, m: f.byCampaign.get(c.id) }))
      .filter((r): r is { id: string; name: string; m: NonNullable<typeof r.m> } => !!r.m)
      .sort((a, b) => b.m.cost - a.m.cost);
  });

  protected readonly goalResult = computed(() => {
    const f = this.f();
    return f ? evaluateGoal(f.total, this.cfg.config().goal, this.cfg.config().thresholds.aboveTargetFactor) : null;
  });

  protected readonly unconfirmed = computed(
    () => this.f()?.resolutions.filter((r) => !r.confirmed && r.stage !== 'IGNORE').length ?? 0,
  );

  // ── Meta (formulário com Signal Forms)
  private readonly goalValue = linkedSignal(() => {
    const g = this.cfg.config().goal;
    return {
      stage: g.goalStage as GoalStage,
      target: g.targetCostPerGoal ?? 0,
      cac: g.targetCac ?? 0,
      roi: g.targetRoiPct ?? 0,
      margin: g.defaultMarginPct ?? 0,
      cycle: g.salesCycleDays,
    };
  });

  protected readonly goalForm = form(
    this.goalValue,
    (p) => {
      min(p.target, 0, { message: 'Use um valor positivo.' });
      min(p.cac, 0, { message: 'Use um valor positivo.' });
      min(p.margin, 0, { message: 'Use entre 0 e 100.' });
      max(p.margin, 100, { message: 'Use entre 0 e 100.' });
      min(p.cycle, 0, { message: 'Use 0 ou mais dias.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.goalValue();
          this.cfg.updateGoal({
            goalStage: v.stage,
            targetCostPerGoal: v.target > 0 ? v.target : null,
            targetCac: v.cac > 0 ? v.cac : null,
            targetRoiPct: v.roi > 0 ? v.roi : null,
            defaultMarginPct: v.margin > 0 ? v.margin : null,
            salesCycleDays: Math.max(0, Math.round(v.cycle)),
          });
          this.toast.success('Meta salva. Os vereditos foram recalculados.');
          return undefined;
        },
      },
    },
  );

  constructor() {
    this.insights.needCore();
  }

  protected cellCount(v: { count: number; source: string }): string {
    return v.source === 'NONE' ? '—' : num(v.count, 1);
  }

  protected setStage(actionName: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as FunnelStage | 'IGNORE';
    this.cfg.setMapping(actionName, value);
  }

  protected confirmAll(): void {
    const f = this.f();
    if (!f) return;
    const next = { ...this.cfg.config().mapping };
    for (const r of f.resolutions) if (!r.confirmed) next[r.name] = r.stage;
    this.cfg.update({ mapping: next });
    this.toast.success('Mapeamento confirmado.');
  }
}
