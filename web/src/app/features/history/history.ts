import { DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, required } from '@angular/forms/signals';
import { ChangesStore, LearningsStore } from '../../core/collections';
import { Insights } from '../../core/insights';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { today } from '../../domain/dates';
import { EffectResult, EffectVerdict, evaluateChange } from '../../domain/effects';
import { ChangeEntry, ChangeKind, ChangeSource, Learning, LearningVerdict } from '../../domain/models';
import { parseTermList } from '../../domain/classify';
import { ConfidenceBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { Icon } from '../../shared/icon';
import { AppModal } from '../../shared/modal';
import { ExportData, PageHeader } from '../../shared/page-header';
import { Diagnosis, DiagnosisTone } from '../../shared/diagnosis';
import { EChart, VERDICT_COLOR } from '../../shared/echart';
import { Kpi } from '../../shared/kpi';
import type { EChartsCoreOption } from 'echarts/core';

const KIND_LABEL: Record<ChangeKind, string> = {
  CAMPAIGN: 'Campanha',
  KEYWORD: 'Palavra-chave',
  NEGATIVE: 'Negativação',
  BID: 'Lance',
  AD: 'Anúncio',
  URL: 'URL / destino',
  PAGE: 'Página do site',
  CONTENT: 'Conteúdo',
  SERVICE: 'Atendimento',
  TRACKING: 'Medição',
  OTHER: 'Outra',
};

const SOURCE_LABEL: Record<ChangeSource, string> = {
  APP: 'Feito pelo painel',
  GOOGLE_ADS: 'Google Ads',
  MANUAL: 'Registro manual',
};

const VERDICT_LABEL: Record<EffectVerdict, string> = {
  WAITING: 'Aguardando dados',
  IMPROVED: 'Melhorou',
  WORSENED: 'Piorou',
  NO_CLEAR_EFFECT: 'Sem efeito claro',
  NOT_EVALUABLE: 'Não mensurável',
};

const VERDICT_CLASS: Record<EffectVerdict, string> = {
  WAITING: 'badge badge-soft badge-info badge-sm',
  IMPROVED: 'badge badge-soft badge-success badge-sm',
  WORSENED: 'badge badge-soft badge-error badge-sm',
  NO_CLEAR_EFFECT: 'badge badge-soft badge-sm',
  NOT_EVALUABLE: 'badge badge-dash badge-sm',
};

const LEARNING_LABEL: Record<LearningVerdict, string> = {
  CONFIRMED: 'Confirmado',
  REFUTED: 'Refutado',
  INCONCLUSIVE: 'Inconclusivo',
};

const LEARNING_CLASS: Record<LearningVerdict, string> = {
  CONFIRMED: 'badge badge-soft badge-success badge-sm',
  REFUTED: 'badge badge-soft badge-error badge-sm',
  INCONCLUSIVE: 'badge badge-soft badge-sm',
};

interface Group {
  key: string;
  first: ChangeEntry;
  count: number;
  effect: EffectResult;
}

@Component({
  selector: 'app-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Diagnosis, EChart, Kpi, DecimalPipe, PercentPipe, AppModal, ConfidenceBadge, DataState, FormField, FormRoot, Icon, PageHeader],
  template: `
    <app-page-header
      group="Inteligência"
      lead="Histórico"
      title="e aprendizado"
      subtitle="O que foi mudado, quando, e o que aconteceu depois. O painel avisa de regressões e guarda o que você aprendeu."
      [exportData]="exportData()"
    />

    <div class="flex flex-col gap-block">
      <div class="stats">
        <app-kpi label="Mudanças registradas" [value]="changes().length + ''" tip="Inclui as feitas pelo painel, as lidas do Google Ads (últimos 30 dias) e as registradas à mão." note="inclui o que veio do Google Ads" />
        <app-kpi label="Melhoraram" [value]="summary().improved + ''" tip="Mudanças em que a taxa de conversão melhorou de forma estatisticamente relevante, comparando 14 dias antes e depois." [note]="summary().evaluated + ' com dados para avaliar'" />
        <app-kpi label="Regressões" [value]="summary().regressions + ''" tip="Pioraram depois da mudança, de forma estatisticamente relevante." note="pioraram depois da mudança" />
        <app-kpi label="Aprendizados" [value]="learnings().length + ''" tip="Hipóteses que você registrou como confirmadas, refutadas ou inconclusivas." note="hipóteses registradas" />
      </div>

      <app-diagnosis [kind]="diagnosis().tone" [title]="diagnosis().title">{{ diagnosis().text }}</app-diagnosis>

      @if (effectChart(); as chart) {
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <h2 class="text-base font-semibold">Efeito de cada decisão no custo por conversão</h2>
            <p class="text-sm text-base-content/70">
              Variação do custo por conversão 14 dias depois, frente aos 14 dias antes. Negativo é bom (ficou mais barato).
            </p>
            <app-echart [option]="chart" [height]="chartHeight()" label="Variação do custo por conversão depois de cada mudança" />
          </div>
        </section>
      }

      @if (regressions().length) {
        <div role="alert" class="alert alert-error alert-soft">
          <app-icon name="warning" />
          <div class="min-w-0">
            <h3 class="font-semibold">Possível regressão depois de uma mudança</h3>
            <ul class="mt-1 list-disc pl-5 text-sm">
              @for (g of regressions(); track g.key) {
                <li>
                  {{ g.first.title }} ({{ g.first.at.slice(0, 10) }}): {{ g.effect.note }}
                  @if (g.effect.confounders.length) {
                    Houve {{ g.effect.confounders.length }} outra(s) mudança(s) no período.
                  }
                </li>
              }
            </ul>
          </div>
        </div>
      }

      <div role="tablist" class="tabs tabs-border">
        <button type="button" role="tab" class="tab" [class.tab-active]="tab() === 'changes'" [attr.aria-selected]="tab() === 'changes'" (click)="tab.set('changes')">
          Mudanças
        </button>
        <button type="button" role="tab" class="tab" [class.tab-active]="tab() === 'learnings'" [attr.aria-selected]="tab() === 'learnings'" (click)="tab.set('learnings')">
          Aprendizados
        </button>
      </div>

      @if (tab() === 'changes') {
        <div class="flex flex-wrap items-center gap-2">
          <select class="select select-sm" aria-label="Tipo" [value]="kind()" (change)="kind.set(val($event))">
            <option value="ALL">Todos os tipos</option>
            @for (k of kinds; track k.key) {
              <option [value]="k.key">{{ k.label }}</option>
            }
          </select>
          <select class="select select-sm" aria-label="Origem" [value]="source()" (change)="source.set(val($event))">
            <option value="ALL">Todas as origens</option>
            <option value="APP">Feito pelo painel</option>
            <option value="GOOGLE_ADS">Google Ads</option>
            <option value="MANUAL">Registro manual</option>
          </select>
          <div class="ml-auto flex flex-wrap gap-2">
            <button type="button" class="btn btn-sm" [disabled]="importing()" (click)="importFromAds()">
              @if (importing()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                <app-icon name="download" size="sm" />
              }
              Importar do Google Ads
            </button>
            <button type="button" class="btn btn-sm" (click)="openChange()">
              <app-icon name="plus" size="sm" /> Registrar mudança
            </button>
          </div>
        </div>

        <p class="text-xs text-base-content/60">
          O Google Ads só guarda 30 dias de histórico. Cada importação salva neste navegador o que foi visto, e o
          histórico passa a crescer além desse limite.
        </p>

        <app-data-state
          [loading]="ws.daily.loading()"
          [error]="ws.daily.error()"
          [hasData]="!!ws.daily.value()"
          (retry)="ws.daily.reload()"
        >
          <ol class="flex flex-col gap-3">
            @for (g of groups(); track g.key) {
              <li class="card card-border bg-base-100">
                <div class="card-body gap-3 p-4">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium tabular">{{ g.first.at.slice(0, 10) }}</span>
                    <span class="badge badge-soft badge-sm">{{ kindLabel(g.first.kind) }}</span>
                    <span class="badge badge-ghost badge-sm">{{ sourceLabel(g.first.source) }}</span>
                    @if (g.first.campaignId) {
                      <span class="badge badge-ghost badge-sm">{{ campaignName(g.first.campaignId) }}</span>
                    }
                    <span [class]="verdictClass(g.effect.verdict)" class="ml-auto">{{ verdictLabel(g.effect.verdict) }}</span>
                  </div>

                  <div>
                    <h3 class="font-semibold break-words">
                      {{ g.first.title }}
                      @if (g.count > 1) {
                        <span class="text-base-content/60">×{{ g.count }}</span>
                      }
                    </h3>
                    @if (g.first.description) {
                      <p class="mt-1 text-sm text-base-content/70 break-words">{{ g.first.description }}</p>
                    }
                    @if (g.first.expected) {
                      <p class="mt-1 text-sm"><span class="text-base-content/60">Esperado:</span> {{ g.first.expected }}</p>
                    }
                    @if (g.first.author) {
                      <p class="mt-1 text-xs text-base-content/60">por {{ g.first.author }}</p>
                    }
                  </div>

                  <div class="rounded-box bg-base-200 p-3 text-sm">
                    <p>{{ g.effect.note }}</p>
                    @if (g.effect.before && g.effect.after) {
                      <div class="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                        <div>
                          <div class="text-base-content/60">Conversão antes</div>
                          <div class="tabular font-medium">{{ g.effect.before.conversionRate | percent: '1.1-1' }}</div>
                        </div>
                        <div>
                          <div class="text-base-content/60">Conversão depois</div>
                          <div class="tabular font-medium">{{ g.effect.after.conversionRate | percent: '1.1-1' }}</div>
                        </div>
                        <div>
                          <div class="text-base-content/60">Custo/conv. antes</div>
                          <div class="tabular font-medium">
                            @if (g.effect.before.costPerConversion !== null) {
                              R$ {{ g.effect.before.costPerConversion | number: '1.2-2' }}
                            } @else {
                              —
                            }
                          </div>
                        </div>
                        <div>
                          <div class="text-base-content/60">Custo/conv. depois</div>
                          <div class="tabular font-medium">
                            @if (g.effect.after.costPerConversion !== null) {
                              R$ {{ g.effect.after.costPerConversion | number: '1.2-2' }}
                            } @else {
                              —
                            }
                          </div>
                        </div>
                      </div>
                    }
                    @if (g.effect.confounders.length) {
                      <p class="mt-2 text-xs text-warning">
                        {{ g.effect.confounders.length }} outra(s) mudança(s) no mesmo período:
                        {{ confounderNames(g.effect) }}.
                      </p>
                    }
                  </div>

                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <app-confidence [level]="g.effect.confidence.level" />
                    <div class="flex gap-2">
                      <button type="button" class="btn btn-ghost btn-xs" (click)="learnFrom(g)">
                        <app-icon name="light-bulb" size="xs" /> Registrar aprendizado
                      </button>
                      @if (g.first.source === 'MANUAL') {
                        <button type="button" class="btn btn-ghost btn-xs text-error" (click)="removeChange(g.first.id)">
                          Excluir
                        </button>
                      }
                    </div>
                  </div>
                </div>
              </li>
            } @empty {
              <li class="rounded-box border border-dashed border-base-300 p-8 text-center text-sm text-base-content/70">
                Nenhuma mudança registrada. Negativações e ajustes feitos pelo painel entram aqui sozinhos; use
                "Registrar mudança" para páginas, conteúdo e atendimento.
              </li>
            }
          </ol>
        </app-data-state>
      } @else {
        <div class="flex justify-end">
          <button type="button" class="btn btn-sm" (click)="openLearning(null)">
            <app-icon name="plus" size="sm" /> Novo aprendizado
          </button>
        </div>
        <ul class="grid gap-3 lg:grid-cols-2">
          @for (l of learnings(); track l.id) {
            <li class="card card-border bg-base-100">
              <div class="card-body gap-2 p-4">
                <div class="flex flex-wrap items-center gap-2">
                  <span [class]="learningClass(l.verdict)">{{ learningLabel(l.verdict) }}</span>
                  <span class="text-xs text-base-content/60">{{ l.at }}</span>
                  @for (t of l.tags; track t) {
                    <span class="badge badge-ghost badge-xs">{{ t }}</span>
                  }
                </div>
                <h3 class="font-semibold break-words">{{ l.title }}</h3>
                <p class="text-sm text-base-content/80 whitespace-pre-line">{{ l.insight }}</p>
                <div class="card-actions justify-end">
                  <button type="button" class="btn btn-ghost btn-xs text-error" (click)="removeLearning(l.id)">Excluir</button>
                </div>
              </div>
            </li>
          } @empty {
            <li class="rounded-box border border-dashed border-base-300 p-8 text-center text-sm text-base-content/70 lg:col-span-2">
              Ainda não há aprendizados. Eles nascem de hipóteses concluídas e de mudanças cujo efeito você analisou.
            </li>
          }
        </ul>
      }
    </div>

    <!-- Nova mudança -->
    <app-modal [(open)]="changeOpen" size="md">
      <h3 class="text-lg font-semibold">Registrar mudança</h3>
      <p class="mt-1 text-sm text-base-content/70">
        Página, conteúdo, atendimento, medição ou qualquer ajuste feito fora do painel.
      </p>
      <form [formRoot]="changeForm" class="mt-4 grid gap-3 sm:grid-cols-2">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Tipo</legend>
          <select class="select w-full" [formField]="changeForm.kind">
            @for (k of kinds; track k.key) {
              <option [value]="k.key">{{ k.label }}</option>
            }
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Data</legend>
          <input type="date" class="input w-full" [formField]="changeForm.date" />
          @if (changeForm.date().touched() && changeForm.date().errors().length) {
            <p class="label text-error">{{ changeForm.date().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">O que mudou</legend>
          <input type="text" class="input w-full" [formField]="changeForm.title" />
          @if (changeForm.title().touched() && changeForm.title().errors().length) {
            <p class="label text-error">{{ changeForm.title().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Detalhes</legend>
          <textarea class="textarea h-20 w-full" [formField]="changeForm.description"></textarea>
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Campanha afetada</legend>
          <select class="select w-full" [formField]="changeForm.campaignId">
            <option value="">Conta inteira / não se aplica</option>
            @for (c of campaigns(); track c.id) {
              <option [value]="c.id">{{ c.name }}</option>
            }
          </select>
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Efeito esperado</legend>
          <input type="text" class="input w-full" placeholder="Ex.: aumentar a taxa de contato da página" [formField]="changeForm.expected" />
        </fieldset>
        <div class="modal-action sm:col-span-2">
          <button type="button" class="btn btn-ghost" (click)="changeOpen.set(false)">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>
    </app-modal>

    <!-- Novo aprendizado -->
    <app-modal [(open)]="learningOpen" size="md">
      <h3 class="text-lg font-semibold">Registrar aprendizado</h3>
      <form [formRoot]="learningForm" class="mt-4 flex flex-col gap-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Título</legend>
          <input type="text" class="input w-full" [formField]="learningForm.title" />
          @if (learningForm.title().touched() && learningForm.title().errors().length) {
            <p class="label text-error">{{ learningForm.title().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">O que aprendemos</legend>
          <textarea class="textarea h-28 w-full" [formField]="learningForm.insight"></textarea>
          @if (learningForm.insight().touched() && learningForm.insight().errors().length) {
            <p class="label text-error">{{ learningForm.insight().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Resultado</legend>
          <select class="select w-full" [formField]="learningForm.verdict">
            <option value="CONFIRMED">Confirmado</option>
            <option value="REFUTED">Refutado</option>
            <option value="INCONCLUSIVE">Inconclusivo</option>
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Etiquetas (separadas por vírgula)</legend>
          <input type="text" class="input w-full" placeholder="negativação, display, página" [formField]="learningForm.tags" />
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" (click)="learningOpen.set(false)">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>
    </app-modal>
  `,
})
export class HistoryPage {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  private readonly changesStore = inject(ChangesStore);
  private readonly learningsStore = inject(LearningsStore);
  private readonly toast = inject(ToastService);

  protected readonly tab = signal<'changes' | 'learnings'>('changes');
  protected readonly kind = signal<'ALL' | ChangeKind>('ALL');
  protected readonly source = signal<'ALL' | ChangeSource>('ALL');
  protected readonly importing = signal(false);

  protected readonly kinds = (Object.keys(KIND_LABEL) as ChangeKind[]).map((key) => ({ key, label: KIND_LABEL[key] }));
  protected readonly changes = this.changesStore.items;
  protected readonly learnings = computed(() =>
    [...this.learningsStore.items()].sort((a, b) => b.at.localeCompare(a.at)),
  );
  protected readonly campaigns = computed(() => this.ws.campaigns.value() ?? []);

  /** Agrupa o que aconteceu junto (ex.: 12 negativações no mesmo dia) em uma linha só. */
  protected readonly groups = computed<Group[]>(() => {
    const daily = this.ws.daily.value() ?? [];
    const all = this.changes();
    const k = this.kind();
    const s = this.source();
    const buckets = new Map<string, ChangeEntry[]>();
    for (const c of all) {
      if ((k !== 'ALL' && c.kind !== k) || (s !== 'ALL' && c.source !== s)) continue;
      const key = [c.at.slice(0, 10), c.kind, c.source, c.campaignId ?? '', c.author ?? '', c.title].join('|');
      const list = buckets.get(key) ?? [];
      list.push(c);
      buckets.set(key, list);
    }
    return Array.from(buckets, ([key, list]) => ({
      key,
      first: list[0],
      count: list.length,
      effect: evaluateChange(list[0], daily, all),
    })).sort((a, b) => b.first.at.localeCompare(a.first.at));
  });

  protected readonly regressions = computed(() => this.groups().filter((g) => g.effect.regression).slice(0, 5));

  protected readonly summary = computed(() => {
    const g = this.groups();
    return {
      improved: g.filter((x) => x.effect.verdict === 'IMPROVED').length,
      regressions: g.filter((x) => x.effect.regression).length,
      evaluated: g.filter((x) => x.effect.verdict !== 'WAITING' && x.effect.verdict !== 'NOT_EVALUABLE').length,
    };
  });

  protected readonly diagnosis = computed<{ tone: DiagnosisTone; title: string; text: string }>(() => {
    const s = this.summary();
    if (!this.changes().length) {
      return {
        tone: 'info',
        title: 'Nenhuma mudança registrada ainda',
        text: 'Importe as mudanças do Google Ads ou registre as suas. Cada uma é avaliada com 14 dias antes e depois.',
      };
    }
    if (s.regressions) {
      return {
        tone: 'bad',
        title: `${s.regressions} ${s.regressions === 1 ? 'mudança piorou' : 'mudanças pioraram'} o resultado`,
        text: 'Veja abaixo qual foi e considere desfazer. Confira também se houve outra mudança no mesmo período, que pode ser a causa.',
      };
    }
    if (s.improved) {
      return {
        tone: 'ok',
        title: `${s.improved} ${s.improved === 1 ? 'mudança melhorou' : 'mudanças melhoraram'} o resultado`,
        text: `Das ${s.evaluated} mudanças com dados suficientes, nenhuma piorou. Registre o que funcionou como aprendizado para repetir.`,
      };
    }
    return {
      tone: 'info',
      title: s.evaluated ? 'Nenhuma mudança teve efeito claro até agora' : 'As mudanças ainda não têm dados suficientes',
      text: s.evaluated
        ? 'As variações cabem no acaso. Dê mais tempo ou faça mudanças maiores para conseguir medir.'
        : 'Cada mudança precisa de alguns dias e cliques depois dela para ser avaliada.',
    };
  });

  private readonly measured = computed(() =>
    this.groups()
      .filter((g) => g.effect.costPerConversionChange !== null)
      .slice(0, 10),
  );

  protected readonly chartHeight = computed(() => Math.max(160, this.measured().length * 34 + 40));

  protected readonly effectChart = computed<EChartsCoreOption | null>(() => {
    const rows = this.measured();
    if (!rows.length) return null;
    const label = (g: Group): string => `${g.first.at.slice(8, 10)}/${g.first.at.slice(5, 7)} · ${g.first.title}`;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${v > 0 ? '+' : ''}${v}%` },
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}%` } },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map(label),
        axisLabel: { width: 260, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          data: rows.map((g) => {
            const v = Math.round((g.effect.costPerConversionChange ?? 0) * 1000) / 10;
            return { value: v, itemStyle: { color: v <= 0 ? VERDICT_COLOR.performing : VERDICT_COLOR.waste } };
          }),
        },
      ],
    };
  });

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'historico-de-mudancas',
    rows: this.groups().map((g) => ({
      Data: g.first.at.slice(0, 10),
      Mudança: g.first.title,
      Tipo: KIND_LABEL[g.first.kind],
      Origem: SOURCE_LABEL[g.first.source],
      Quantidade: g.count,
      Efeito: VERDICT_LABEL[g.effect.verdict],
      'Variação do custo por conversão (%)':
        g.effect.costPerConversionChange === null ? '' : Math.round(g.effect.costPerConversionChange * 1000) / 10,
      Observação: g.effect.note,
    })),
  }));

  constructor() {
    this.ws.daily.need();
    this.ws.campaigns.need();
    this.ws.changeEvents.need();
  }

  protected val(event: Event): never {
    return (event.target as HTMLSelectElement).value as never;
  }

  protected kindLabel = (k: ChangeKind): string => KIND_LABEL[k];
  protected sourceLabel = (s: ChangeSource): string => SOURCE_LABEL[s];
  protected verdictLabel = (v: EffectVerdict): string => VERDICT_LABEL[v];
  protected verdictClass = (v: EffectVerdict): string => VERDICT_CLASS[v];
  protected learningLabel = (v: LearningVerdict): string => LEARNING_LABEL[v];
  protected learningClass = (v: LearningVerdict): string => LEARNING_CLASS[v];

  protected campaignName(id: string): string {
    return this.campaigns().find((c) => c.id === id)?.name ?? `Campanha ${id}`;
  }

  protected confounderNames(e: EffectResult): string {
    return e.confounders
      .slice(0, 3)
      .map((c) => `${c.title} (${c.at.slice(0, 10)})`)
      .join('; ');
  }

  // ── Importação do Google Ads
  protected async importFromAds(): Promise<void> {
    this.importing.set(true);
    try {
      this.ws.changeEvents.reload();
      // Aguarda o carregamento terminar (o recurso atualiza o valor de forma assíncrona).
      const started = Date.now();
      while (this.ws.changeEvents.loading() && Date.now() - started < 30_000) {
        await new Promise((r) => setTimeout(r, 150));
      }
      const error = this.ws.changeEvents.error();
      if (error) {
        this.toast.error(error);
        return;
      }
      const events = this.ws.changeEvents.value() ?? [];
      const added = await this.changesStore.importGoogleChanges(events);
      this.toast.success(
        added > 0
          ? `${added} mudança(s) nova(s) importada(s) do Google Ads.`
          : 'Nenhuma mudança nova nos últimos 30 dias.',
      );
    } finally {
      this.importing.set(false);
    }
  }

  // ── Registro manual de mudança
  protected readonly changeOpen = signal(false);
  private readonly changeValue = signal({
    kind: 'PAGE' as ChangeKind,
    date: today(),
    title: '',
    description: '',
    campaignId: '',
    expected: '',
  });

  protected readonly changeForm = form(
    this.changeValue,
    (p) => {
      required(p.title, { message: 'Descreva o que mudou.' });
      required(p.date, { message: 'Informe a data.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.changeValue();
          await this.changesStore.add({
            at: `${v.date}T00:00:00`,
            kind: v.kind,
            title: v.title.trim(),
            description: v.description.trim() || undefined,
            source: 'MANUAL',
            campaignId: v.campaignId || undefined,
            expected: v.expected.trim() || undefined,
          } as Omit<ChangeEntry, 'id' | 'accountId'>);
          this.toast.success('Mudança registrada.');
          this.changeOpen.set(false);
          return undefined;
        },
      },
    },
  );

  protected openChange(): void {
    this.changeValue.set({ kind: 'PAGE', date: today(), title: '', description: '', campaignId: '', expected: '' });
    this.changeForm().reset();
    this.changeOpen.set(true);
  }

  protected async removeChange(id: string): Promise<void> {
    await this.changesStore.remove(id);
  }

  // ── Aprendizados
  protected readonly learningOpen = signal(false);
  private readonly learningValue = signal({
    title: '',
    insight: '',
    verdict: 'INCONCLUSIVE' as LearningVerdict,
    tags: '',
  });
  private learningSource: string | undefined;

  protected readonly learningForm = form(
    this.learningValue,
    (p) => {
      required(p.title, { message: 'Dê um título.' });
      required(p.insight, { message: 'Escreva o que foi aprendido.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.learningValue();
          await this.learningsStore.add({
            at: today(),
            title: v.title.trim(),
            insight: v.insight.trim(),
            verdict: v.verdict,
            tags: parseTermList(v.tags),
            sourceId: this.learningSource,
          } as Omit<Learning, 'id' | 'accountId'>);
          this.toast.success('Aprendizado guardado.');
          this.learningOpen.set(false);
          return undefined;
        },
      },
    },
  );

  protected openLearning(prefill: { title: string; insight: string; verdict: LearningVerdict; sourceId?: string } | null): void {
    this.learningSource = prefill?.sourceId;
    this.learningValue.set({
      title: prefill?.title ?? '',
      insight: prefill?.insight ?? '',
      verdict: prefill?.verdict ?? 'INCONCLUSIVE',
      tags: '',
    });
    this.learningForm().reset();
    this.learningOpen.set(true);
  }

  protected learnFrom(g: Group): void {
    this.openLearning({
      title: g.first.title,
      insight: g.effect.note,
      verdict:
        g.effect.verdict === 'IMPROVED' ? 'CONFIRMED' : g.effect.verdict === 'WORSENED' ? 'REFUTED' : 'INCONCLUSIVE',
      sourceId: g.first.id,
    });
    this.tab.set('learnings');
  }

  protected async removeLearning(id: string): Promise<void> {
    await this.learningsStore.remove(id);
  }
}
