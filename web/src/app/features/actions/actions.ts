import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BatchNegatives } from '../../core/batch-negatives';
import { ChangesStore, RecStatesStore } from '../../core/collections';
import { describeError } from '../../core/dataset';
import { Insights, RecommendationView } from '../../core/insights';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { IntegrationsApi } from '../../data/integrations.api';
import { narrate, toPlainText } from '../../domain/narrative';
import {
  ChangeEntry,
  ChangeKind,
  RecommendationCategory,
  RecommendationStatus,
} from '../../domain/models';
import { ConfidenceBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { EvidenceList } from '../../shared/evidence-list';
import { Icon } from '../../shared/icon';
import { IconName } from '../../shared/icons';
import { AppModal } from '../../shared/modal';
import { ExportData, PageHeader } from '../../shared/page-header';
import { BarItem, BarList } from '../../shared/bar-list';
import { Diagnosis, DiagnosisTone } from '../../shared/diagnosis';
import { Kpi } from '../../shared/kpi';
import { brl } from '../../domain/format';

const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  TRACKING: 'Medição',
  WASTE: 'Desperdício',
  CAMPAIGN: 'Campanha',
  FUNNEL: 'Funil e atendimento',
  LANDING_PAGE: 'Página de destino',
  CONTENT: 'Conteúdo',
  DATA_QUALITY: 'Qualidade dos dados',
};

const CATEGORY_ICON: Record<RecommendationCategory, IconName> = {
  TRACKING: 'warning',
  WASTE: 'ban',
  CAMPAIGN: 'folder',
  FUNNEL: 'funnel',
  LANDING_PAGE: 'link',
  CONTENT: 'document',
  DATA_QUALITY: 'database',
};

const CHANGE_KIND: Record<RecommendationCategory, ChangeKind> = {
  TRACKING: 'TRACKING',
  WASTE: 'OTHER',
  CAMPAIGN: 'CAMPAIGN',
  FUNNEL: 'SERVICE',
  LANDING_PAGE: 'URL',
  CONTENT: 'CONTENT',
  DATA_QUALITY: 'OTHER',
};

type Tab = RecommendationStatus;

@Component({
  selector: 'app-actions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, AppModal, BarList, ConfidenceBadge, DataState, Diagnosis, EvidenceList, Icon, Kpi, PageHeader],
  template: `
    <app-page-header data-open-help="acoes-introducao"
      group="Inteligência"
      title="Plano de ação"
      subtitle="O que fazer, por quê, com que evidência e como saber se funcionou. Tudo o que o painel concluiu, ordenado por impacto e confiança."
      [exportData]="exportData()"
    />

    <app-data-state
      [loading]="insights.loadingCore()"
      [error]="insights.coreError()"
      [hasData]="!!insights.funnel()"
      (retry)="ws.reloadAll()"
    >
      <div class="flex flex-col gap-block">
        <div class="stats" data-open-help="acoes-indicadores">
          <app-kpi label="Ações pendentes" [value]="count('OPEN') + ''" tip="Recomendações abertas, ainda não aceitas nem descartadas." note="aguardando decisão" />
          <app-kpi
            label="Impacto estimado"
            [value]="pendingImpact() > 0 ? money(pendingImpact()) : 'Não estimado'"
            [unavailable]="pendingImpact() === 0"
            tip="Mensalizar o gasto não prevê economia. Um impacto financeiro exige dados comparáveis e validação do efeito sobre as conversões valiosas."
            note="gasto em revisão não é economia garantida"
          />
          <app-kpi label="Em andamento" [value]="count('ACCEPTED') + ''" tip="Ações que você aceitou e ainda não marcou como feitas." note="aceitas" />
          <app-kpi label="Concluídas" [value]="count('DONE') + ''" tip="Ações marcadas como feitas. O efeito aparece em Histórico." note="marcadas como feitas" />
        </div>

        <app-diagnosis [kind]="diagnosis().tone" [title]="diagnosis().title">{{ diagnosis().text }}</app-diagnosis>

        <section class="card card-border bg-base-100" data-open-help="acoes-impacto">
          <div class="card-body gap-4">
            <div>
              <h2 class="text-base font-semibold">Impacto pendente por frente</h2>
              <p class="text-sm text-base-content/70">Exibido apenas quando houver uma estimativa sustentada por dados. Públicos, páginas e horários podem representar o mesmo gasto e não devem ser somados.</p>
            </div>
            <app-bar-list [items]="impactBars()" empty="Nenhuma ação pendente tem impacto em reais estimável." />
          </div>
        </section>

        <div class="flex flex-wrap items-center gap-3" data-open-help="acoes-filtros">
          <div role="tablist" class="tabs tabs-box">
            @for (t of tabs; track t.value) {
              <button
                type="button"
                role="tab"
                class="tab"
                [class.tab-active]="tab() === t.value"
                [attr.aria-selected]="tab() === t.value"
                (click)="tab.set(t.value)"
              >
                {{ t.label }} ({{ count(t.value) }})
              </button>
            }
          </div>

          <select class="select select-sm" aria-label="Categoria" [value]="category()" (change)="category.set(val($event))">
            <option value="ALL">Todas as categorias</option>
            @for (c of categories; track c.key) {
              <option [value]="c.key">{{ c.label }}</option>
            }
          </select>
        </div>

        <ul class="flex flex-col gap-3">
          @for (r of visible(); track r.id) {
            <li class="card card-border bg-base-100">
              <div class="card-body gap-4 p-4 sm:p-6">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="badge badge-soft gap-1">
                    <app-icon [name]="icon(r.category)" size="xs" /> {{ categoryLabel(r.category) }}
                  </span>
                  <app-confidence [level]="r.confidence.level" />
                  @if (r.impact.monthlyCostBrl) {
                    <span class="badge badge-ghost">até {{ r.impact.monthlyCostBrl | currency: 'BRL' : 'symbol' : '1.0-0' }}/mês</span>
                  }
                </div>

                <div>
                  <h2 class="text-base font-semibold break-words">{{ r.title }}</h2>
                  <p class="mt-1 text-sm text-base-content/80">{{ r.problem }}</p>
                </div>

                <div class="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Ação sugerida</div>
                    <p>{{ r.action }}</p>
                  </div>
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Impacto estimado</div>
                    <p>{{ r.impact.description }}</p>
                  </div>
                </div>

                <details class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200/40">
                  <summary class="collapse-title min-h-0 py-2 text-sm font-medium">
                    Evidências, base da estimativa e validação
                  </summary>
                  <div class="collapse-content flex flex-col gap-4 text-sm">
                    <app-evidence-list [items]="r.evidence" />
                    <div class="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Base da estimativa</div>
                        <p>{{ r.impact.basis }}</p>
                      </div>
                      <div>
                        <div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Como validar</div>
                        <p>{{ r.validation }}</p>
                      </div>
                    </div>
                    <div>
                      <div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Por que esta confiança</div>
                      <ul class="list-disc pl-5">
                        @for (reason of r.confidence.reasons; track reason) {
                          <li>{{ reason }}</li>
                        }
                      </ul>
                    </div>
                  </div>
                </details>

                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap gap-2">
                    @if (r.actionButton; as b) {
                      @if (b.kind !== 'NONE') {
                        <button type="button" class="btn btn-sm" (click)="run(r)">
                          <app-icon [name]="b.kind === 'NEGATE_TERMS' ? 'ban' : 'arrow-right'" size="sm" /> {{ b.label }}
                        </button>
                      }
                    }
                    <button type="button" class="btn btn-ghost btn-sm" (click)="explain(r)">
                      <app-icon name="sparkles" size="sm" /> Explicar em linguagem simples
                    </button>
                  </div>

                  <div class="flex flex-wrap gap-2">
                    @switch (r.status) {
                      @case ('OPEN') {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="setStatus(r, 'ACCEPTED')">Aceitar</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="setStatus(r, 'DISMISSED')">Descartar</button>
                      }
                      @case ('ACCEPTED') {
                        <button type="button" class="btn btn-sm" (click)="askDone(r)">
                          <app-icon name="check" size="sm" /> Marcar como feita
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="setStatus(r, 'OPEN')">Reabrir</button>
                      }
                      @default {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="setStatus(r, 'OPEN')">Reabrir</button>
                      }
                    }
                  </div>
                </div>
              </div>
            </li>
          } @empty {
            <li class="rounded-box border border-dashed border-base-300 p-8 text-center text-sm text-base-content/70">
              Nada nesta lista. Isso é bom, ou significa que ainda faltam dados para concluir algo.
            </li>
          }
        </ul>
      </div>
    </app-data-state>

    <!-- Explicação em linguagem simples -->
    <app-modal [(open)]="explainOpen" size="lg">
      @if (explaining(); as r) {
        @let n = narrative();
        @if (n) {
          <h3 class="flex items-start gap-2 text-lg font-semibold">
            <app-icon name="sparkles" /> <span>{{ n.headline }}</span>
          </h3>
          <div class="mt-4 flex flex-col gap-4">
            @for (s of n.sections; track s.title) {
              <section>
                <h4 class="text-xs font-semibold uppercase tracking-wide text-base-content/60">{{ s.title }}</h4>
                @if (s.text) {
                  <p class="mt-1 text-sm">{{ s.text }}</p>
                }
                @if (s.items?.length) {
                  <ul class="mt-1 list-disc pl-5 text-sm">
                    @for (i of s.items; track i) {
                      <li>{{ i }}</li>
                    }
                  </ul>
                }
              </section>
            }
          </div>

          @if (aiText(); as ai) {
            <div class="mt-4 rounded-box bg-base-200 p-4 text-sm">
              <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-base-content/60">Resumo por IA</div>
              <p class="whitespace-pre-line">{{ ai }}</p>
            </div>
          }
          @if (aiNote(); as note) {
            <div role="note" class="alert alert-soft mt-4 text-sm">{{ note }}</div>
          }
        }
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" (click)="copy()">
            <app-icon name="copy" size="sm" /> Copiar
          </button>
          <button type="button" class="btn btn-ghost" [disabled]="aiLoading()" (click)="askAi(r)">
            @if (aiLoading()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <app-icon name="sparkles" size="sm" />
            }
            Resumir com IA
          </button>
          <button type="button" class="btn" (click)="explainOpen.set(false)">Fechar</button>
        </div>
      }
    </app-modal>

    <!-- Concluir -->
    <app-modal [(open)]="doneOpen" size="md">
      @if (doing(); as r) {
        <h3 class="text-lg font-semibold">Marcar como feita</h3>
        <p class="mt-1 text-sm text-base-content/70">{{ r.title }}</p>
        <label class="label mt-4 cursor-pointer justify-start gap-3">
          <input type="checkbox" class="toggle toggle-sm" [checked]="logIt()" (change)="logIt.set(!logIt())" />
          <span class="text-sm">Registrar no histórico de mudanças (recomendado)</span>
        </label>
        <p class="text-xs text-base-content/60">
          Assim o painel mede o efeito depois de alguns dias e avisa se houve regressão.
        </p>
        <fieldset class="fieldset mt-2">
          <legend class="fieldset-legend">O que foi feito (opcional)</legend>
          <textarea class="textarea h-20 w-full" [value]="doneNote()" (input)="doneNote.set(val($event))"></textarea>
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" (click)="doneOpen.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="confirmDone(r)">Confirmar</button>
        </div>
      }
    </app-modal>
  `,
})
export class ActionsPage {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  private readonly states = inject(RecStatesStore);
  private readonly changes = inject(ChangesStore);
  private readonly batch = inject(BatchNegatives);
  private readonly router = inject(Router);
  private readonly api = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);

  protected readonly tabs: ReadonlyArray<{ value: Tab; label: string }> = [
    { value: 'OPEN', label: 'Abertas' },
    { value: 'ACCEPTED', label: 'Aceitas' },
    { value: 'DONE', label: 'Feitas' },
    { value: 'DISMISSED', label: 'Descartadas' },
  ];
  protected readonly categories = (Object.keys(CATEGORY_LABEL) as RecommendationCategory[]).map((key) => ({
    key,
    label: CATEGORY_LABEL[key],
  }));

  protected readonly tab = signal<Tab>('OPEN');

  protected money = (v: number): string => brl(v);

  private readonly pending = computed(() =>
    this.insights.recommendations().filter((r) => r.status === 'OPEN' || r.status === 'ACCEPTED'),
  );
  protected readonly pendingImpact = computed(() => this.pending().reduce((s, r) => s + (r.impact.monthlyCostBrl ?? 0), 0));

  protected readonly impactBars = computed<BarItem[]>(() => {
    const by = new Map<RecommendationCategory, number>();
    for (const r of this.pending()) {
      if (r.impact.monthlyCostBrl) by.set(r.category, (by.get(r.category) ?? 0) + r.impact.monthlyCostBrl);
    }
    return [...by.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => ({ label: CATEGORY_LABEL[c], value: v, display: `${brl(v)}/mês`, tone: 'info' as const }));
  });

  protected readonly diagnosis = computed<{ tone: DiagnosisTone; title: string; text: string }>(() => {
    const open = this.insights.recommendations().filter((r) => r.status === 'OPEN');
    if (!open.length) {
      return { tone: 'ok', title: 'Nenhuma ação pendente', text: 'Tudo o que o painel concluiu já foi decidido. Novas recomendações aparecem quando os dados mudarem.' };
    }
    const high = open.filter((r) => r.confidence.level === 'HIGH');
    const first = open[0];
    if (high.length) {
      return {
        tone: 'ok',
        title: `Comece pelas ${high.length === 1 ? 'ação' : high.length + ' ações'} de confiança alta`,
        text: `A primeira da lista é "${first.title}". Ações de confiança alta têm evidência suficiente para agir sem esperar mais dados.`,
      };
    }
    return {
      tone: 'info',
      title: `${open.length} ${open.length === 1 ? 'ação pendente' : 'ações pendentes'}, nenhuma com confiança alta`,
      text: 'As conclusões ainda dependem de mais dados ou de configuração. Comece pelas de Medição e Qualidade dos dados, que destravam as demais.',
    };
  });

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'plano-de-acao',
    rows: this.insights.recommendations().map((r) => ({
      Ação: r.title,
      Categoria: CATEGORY_LABEL[r.category],
      Status: { OPEN: 'Pendente', ACCEPTED: 'Em andamento', DONE: 'Concluída', DISMISSED: 'Descartada' }[r.status],
      Confiança: { HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' }[r.confidence.level],
      'Impacto (R$/mês)': r.impact.monthlyCostBrl ? Math.round(r.impact.monthlyCostBrl) : '',
      Problema: r.problem,
      'O que fazer': r.action,
    })),
  }));
  protected readonly category = signal<'ALL' | RecommendationCategory>('ALL');

  protected readonly visible = computed(() => {
    const cat = this.category();
    return this.insights
      .recommendations()
      .filter((r) => r.status === this.tab() && (cat === 'ALL' || r.category === cat));
  });

  constructor() {
    this.insights.needCore();
  }

  protected count(status: Tab): number {
    return this.insights.recommendations().filter((r) => r.status === status).length;
  }

  protected val(event: Event): never {
    return (event.target as HTMLSelectElement | HTMLTextAreaElement).value as never;
  }

  protected categoryLabel = (c: RecommendationCategory): string => CATEGORY_LABEL[c];
  protected icon = (c: RecommendationCategory): IconName => CATEGORY_ICON[c];

  protected run(r: RecommendationView): void {
    const b = r.actionButton;
    if (!b) return;
    if (b.kind === 'NEGATE_TERMS' && b.terms) {
      this.batch.show(b.terms);
    } else if (b.kind === 'ROUTE' && b.route) {
      void this.router.navigate([b.route], { queryParams: b.queryParams });
    }
  }

  protected async setStatus(r: RecommendationView, status: RecommendationStatus): Promise<void> {
    await this.states.setStatus(r.id, status);
  }

  // ── Explicação
  protected readonly explainOpen = signal(false);
  protected readonly explaining = signal<RecommendationView | null>(null);
  protected readonly aiText = signal<string | null>(null);
  protected readonly aiNote = signal<string | null>(null);
  protected readonly aiLoading = signal(false);

  protected readonly narrative = computed(() => {
    const r = this.explaining();
    return r ? narrate(r) : null;
  });

  protected explain(r: RecommendationView): void {
    this.explaining.set(r);
    this.aiText.set(null);
    this.aiNote.set(null);
    this.explainOpen.set(true);
  }

  protected async copy(): Promise<void> {
    const n = this.narrative();
    if (!n) return;
    try {
      await navigator.clipboard.writeText(toPlainText(n));
      this.toast.info('Texto copiado.');
    } catch {
      this.toast.warning('Não foi possível copiar.');
    }
  }

  protected async askAi(r: RecommendationView): Promise<void> {
    const n = narrate(r);
    this.aiLoading.set(true);
    this.aiNote.set(null);
    try {
      const res = await firstValueFrom(this.api.explain({ text: toPlainText(n) }));
      if (res.configured && res.text) this.aiText.set(res.text);
      else this.aiNote.set(res.reason ?? 'A IA não está configurada neste servidor.');
    } catch (e) {
      this.aiNote.set(describeError(e));
    } finally {
      this.aiLoading.set(false);
    }
  }

  // ── Conclusão
  protected readonly doneOpen = signal(false);
  protected readonly doing = signal<RecommendationView | null>(null);
  protected readonly logIt = signal(true);
  protected readonly doneNote = signal('');

  protected askDone(r: RecommendationView): void {
    this.doing.set(r);
    this.logIt.set(true);
    this.doneNote.set('');
    this.doneOpen.set(true);
  }

  protected async confirmDone(r: RecommendationView): Promise<void> {
    const note = this.doneNote().trim();
    await this.states.setStatus(r.id, 'DONE', note || undefined);
    if (this.logIt()) {
      await this.changes.add({
        at: new Date().toISOString().slice(0, 19),
        kind: CHANGE_KIND[r.category],
        title: r.title,
        description: [r.action, note].filter(Boolean).join(' — '),
        source: 'MANUAL',
        entity: r.entity,
        campaignId: r.entity?.type === 'campaign' ? r.entity.id : undefined,
        expected: r.validation,
        externalKey: `rec:${r.id}:${new Date().toISOString().slice(0, 10)}`,
      } as Omit<ChangeEntry, 'id' | 'accountId'>);
      this.toast.success('Registrado no histórico. O efeito será medido nos próximos dias.');
    }
    this.doneOpen.set(false);
  }
}
