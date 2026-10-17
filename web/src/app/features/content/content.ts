import { CurrencyPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormField, FormRoot, form, min, required } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { BusinessConfigStore } from '../../core/business-config.store';
import { ChangesStore, ContentStore, QuestionsStore } from '../../core/collections';
import { describeError } from '../../core/dataset';
import { Insights } from '../../core/insights';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { BRAND } from '../../brand';
import { IntegrationsApi } from '../../data/integrations.api';
import { ROLE_LABEL } from '../../domain/content';
import { today } from '../../domain/dates';
import { evaluateSeriesChange } from '../../domain/effects';
import { INTENT_LABEL } from '../../domain/intent';
import { ChangeEntry, ContentItem, ContentRole, ContentStatus, SearchIntent, SeriesPoint } from '../../domain/models';
import { ConfidenceBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { EvidenceList } from '../../shared/evidence-list';
import { Icon } from '../../shared/icon';
import { AppModal } from '../../shared/modal';
import { PageHeader } from '../../shared/page-header';
import { BarItem, BarList } from '../../shared/bar-list';
import { Diagnosis, DiagnosisTone } from '../../shared/diagnosis';
import { Kpi } from '../../shared/kpi';
import { brl } from '../../domain/format';
import { Sparkline } from '../../shared/sparkline';

const STATUS_LABEL: Record<ContentStatus, string> = {
  IDEA: 'Ideia',
  DRAFT: 'Em produção',
  PUBLISHED: 'Publicado',
  UPDATING: 'Em atualização',
  ARCHIVED: 'Arquivado',
};

const STATUS_CLASS: Record<ContentStatus, string> = {
  IDEA: 'badge badge-soft badge-sm',
  DRAFT: 'badge badge-soft badge-info badge-sm',
  PUBLISHED: 'badge badge-soft badge-success badge-sm',
  UPDATING: 'badge badge-soft badge-warning badge-sm',
  ARCHIVED: 'badge badge-ghost badge-sm',
};

const TYPE_LABEL = { PUBLISH: 'Publicar', UPDATE: 'Atualizar', DISTRIBUTE: 'Distribuir' } as const;
const TYPE_CLASS = {
  PUBLISH: 'badge badge-soft badge-info',
  UPDATE: 'badge badge-soft badge-warning',
  DISTRIBUTE: 'badge badge-soft badge-accent',
} as const;

const INTENTS: SearchIntent[] = ['INFORMATIONAL', 'COMMERCIAL', 'TRANSACTIONAL', 'NAVIGATIONAL', 'SUPPORT'];

@Component({
  selector: 'app-content-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BarList, Diagnosis, Kpi, 
    CurrencyPipe,
    PercentPipe,
    AppModal,
    ConfidenceBadge,
    DataState,
    EvidenceList,
    FormField,
    FormRoot,
    Icon,
    PageHeader,
    Sparkline,
  ],
  template: `
    <app-page-header data-open-help="conteudo-introducao"
      group="Inteligência"
      title="Conteúdo"
      subtitle="Histórico do que foi publicado e atualizado, e o que vale produzir a seguir com base em buscas reais, dúvidas do atendimento e desempenho das páginas."
    />

    <div class="flex flex-col gap-block">
      @if (!organicReady()) {
        <div role="note" class="alert alert-soft">
          <app-icon name="info" />
          <span class="text-sm">
            Sem o Search Console, a demanda orgânica e o efeito das publicações não podem ser medidos. As
            oportunidades abaixo usam só as buscas pagas e as dúvidas do atendimento.
            {{ ws.searchConsoleStatus().reason }}
          </span>
        </div>
      }

      <div class="stats" data-open-help="conteudo-indicadores">
        <app-kpi label="Temas identificados" [value]="opportunities().length + ''" tip="Assuntos com demanda real (buscas pagas, orgânicas ou dúvidas do atendimento) que pedem conteúdo." note="com evidência neste período" />
        <app-kpi label="Temas sem página" [value]="contentKpis().publish + ''" tip="Assuntos procurados que não têm página que os responda." note="pedem conteúdo novo" />
        <app-kpi label="Cliques pagos nesses temas" [value]="contentKpis().clicks + ''" tip="Cliques do Google Ads em buscas de temas sem página: você pagou para levar essas pessoas a páginas que não respondem a pergunta." note="no período" />
        <app-kpi label="Custo pago nesses temas" [value]="money(contentKpis().cost)" tip="Custo do Google Ads nas mesmas buscas." note="no período" />
      </div>

      <app-diagnosis [kind]="contentDiagnosis().tone" [title]="contentDiagnosis().title">{{ contentDiagnosis().text }}</app-diagnosis>

      <section class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <div>
            <h2 class="text-base font-semibold">Temas por volume de busca</h2>
            <p class="text-sm text-base-content/70">Cliques pagos no período em cada tema (orgânico entra quando o Search Console estiver ligado).</p>
          </div>
          <app-bar-list [items]="themeBars()" empty="Nenhum tema com volume suficiente neste período." />
        </div>
      </section>

      <!-- Papéis -->
      <div class="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal">
        @for (r of roleStats(); track r.role) {
          <div class="stat py-3">
            <div class="stat-title">{{ r.label }}</div>
            <div class="stat-value">{{ r.count }}</div>
            <div class="stat-desc">{{ r.help }}</div>
          </div>
        }
      </div>

      <!-- Oportunidades -->
      <section class="card card-border bg-base-100" data-open-help="conteudo-oportunidades">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="light-bulb" size="sm" /> O que publicar, melhorar e distribuir</h2>
            <p class="max-w-3xl text-sm text-base-content/70">
              Cada sugestão mostra de onde veio a demanda e o que não foi possível medir. Conteúdo demora semanas
              para mostrar efeito.
            </p>
          </div>

          <app-data-state
            [loading]="insights.loadingCore()"
            [error]="insights.coreError()"
            [hasData]="!!insights.funnel()"
            (retry)="ws.reloadAll()"
          >
            <div class="grid gap-block lg:grid-cols-2">
              @for (o of opportunities(); track o.id) {
                <article class="card card-border bg-base-100">
                  <div class="card-body gap-3 p-4">
                    <div class="flex flex-wrap items-center gap-2">
                      <span [class]="typeClass(o.type)">{{ typeLabel(o.type) }}</span>
                      <span class="badge badge-ghost badge-sm">{{ roleLabel(o.role) }}</span>
                      <span class="badge badge-ghost badge-sm">{{ intentLabel(o.intent) }}</span>
                      <app-confidence [level]="o.confidence.level" />
                    </div>
                    <h3 class="font-semibold break-words">{{ o.topic }}</h3>
                    <p class="text-sm">{{ o.action }}</p>
                    <app-evidence-list [items]="o.evidence" />
                    <div class="card-actions justify-end">
                      <button type="button" class="btn btn-sm" (click)="register(o)">
                        <app-icon name="plus" size="xs" /> Registrar como ideia
                      </button>
                    </div>
                  </div>
                </article>
              } @empty {
                <div class="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/70 lg:col-span-2">
                  Nenhuma oportunidade com evidência suficiente neste período.
                </div>
              }
            </div>
          </app-data-state>
        </div>
      </section>

      <!-- Dúvidas do atendimento -->
      <section class="card card-border bg-base-100" data-open-help="conteudo-duvidas">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="chat" size="sm" /> Dúvidas do atendimento</h2>
            <p class="max-w-3xl text-sm text-base-content/70">
              O que os clientes perguntam antes de comprar vira pauta. Anote as perguntas mais frequentes.
            </p>
          </div>
          <form [formRoot]="questionForm" class="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Pergunta</legend>
              <input type="text" class="input w-full" placeholder="Ex.: o robô integra com o meu sistema?" [formField]="questionForm.question" />
              @if (questionForm.question().touched() && questionForm.question().errors().length) {
                <p class="label text-error">{{ questionForm.question().errors()[0].message }}</p>
              }
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Quantas vezes</legend>
              <input type="number" class="input w-full" [formField]="questionForm.count" />
            </fieldset>
            <button type="submit" class="btn btn-sm">Adicionar</button>
          </form>
          @if (questions().length) {
            <ul class="list rounded-box border border-base-300">
              @for (q of questions(); track q.id) {
                <li class="list-row items-center">
                  <span class="badge badge-soft badge-sm tabular">{{ q.count }}×</span>
                  <span class="min-w-0 break-words text-sm">{{ q.question }}</span>
                  <button type="button" class="btn btn-ghost btn-xs btn-square" aria-label="Remover pergunta" (click)="removeQuestion(q.id)">
                    <app-icon name="trash" size="xs" />
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      </section>

      <!-- Registro -->
      <section class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="card-title text-base"><app-icon name="document" size="sm" /> Registro de conteúdos</h2>
              <p class="max-w-3xl text-sm text-base-content/70">
                Tema, público, intenção, URL, publicação, atualizações, objetivo e custo de produção.
              </p>
            </div>
            <button type="button" class="btn btn-sm" (click)="openForm(null)">
              <app-icon name="plus" size="sm" /> Novo conteúdo
            </button>
          </div>

          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Conteúdo</th>
                  <th>Papel</th>
                  <th>Status</th>
                  <th>Publicado</th>
                  <th class="text-right">Atualiz.</th>
                  <th class="text-right">Custo</th>
                  <th><span class="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                @for (c of items(); track c.id) {
                  <tr class="hover:bg-base-200/60">
                    <td class="max-w-80">
                      <div class="font-medium break-words">{{ c.title }}</div>
                      <div class="truncate text-xs text-base-content/60" [attr.title]="c.url">
                        {{ c.theme }}{{ c.url ? ' · ' + c.url : '' }}
                      </div>
                    </td>
                    <td class="text-xs">{{ roleLabel(c.role) }}</td>
                    <td><span [class]="statusClass(c.status)">{{ statusLabel(c.status) }}</span></td>
                    <td class="tabular">{{ c.publishedAt || '—' }}</td>
                    <td class="text-right tabular">{{ c.updates.length }}</td>
                    <td class="text-right tabular">
                      @if (c.productionCost) {
                        {{ c.productionCost | currency: 'BRL' : 'symbol' : '1.0-0' }}
                      } @else {
                        <span class="text-base-content/40">—</span>
                      }
                    </td>
                    <td class="whitespace-nowrap">
                      <button type="button" class="btn btn-ghost btn-xs" (click)="showEffect(c)">Efeito</button>
                      <button type="button" class="btn btn-ghost btn-xs" (click)="openUpdate(c)">Atualizou</button>
                      <button type="button" class="btn btn-ghost btn-xs btn-square" aria-label="Editar" (click)="openForm(c)">
                        <app-icon name="pencil" size="xs" />
                      </button>
                      <button type="button" class="btn btn-ghost btn-xs btn-square text-error" aria-label="Excluir" (click)="remove(c.id)">
                        <app-icon name="trash" size="xs" />
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="py-8 text-center text-base-content/60">
                      Nenhum conteúdo registrado. Comece pelas sugestões acima ou cadastre o que já existe.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <!-- Formulário -->
    <app-modal [(open)]="formOpen" size="lg">
      <h3 class="flex items-center gap-2 text-lg font-semibold">
        <app-icon name="document" /> {{ editing() ? 'Editar conteúdo' : 'Novo conteúdo' }}
      </h3>
      <form [formRoot]="contentForm" class="mt-4 grid gap-3 sm:grid-cols-2">
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Título</legend>
          <input type="text" class="input w-full" [formField]="contentForm.title" />
          @if (contentForm.title().touched() && contentForm.title().errors().length) {
            <p class="label text-error">{{ contentForm.title().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">URL (completa, com https)</legend>
          <input type="text" class="input w-full font-mono text-xs" placeholder="https://www.seusite.com.br/artigo/" [formField]="contentForm.url" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Tema</legend>
          <input type="text" class="input w-full" [formField]="contentForm.theme" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Público</legend>
          <input type="text" class="input w-full" placeholder="Ex.: donos de clínica" [formField]="contentForm.audience" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Intenção da busca</legend>
          <select class="select w-full" [formField]="contentForm.intent">
            @for (i of intents; track i) {
              <option [value]="i">{{ intentLabel(i) }}</option>
            }
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Papel</legend>
          <select class="select w-full" [formField]="contentForm.role">
            <option value="ATTRACT">Atrai visitas</option>
            <option value="DECIDE">Ajuda na decisão</option>
            <option value="CONVERT">Gera oportunidade comercial</option>
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Status</legend>
          <select class="select w-full" [formField]="contentForm.status">
            <option value="IDEA">Ideia</option>
            <option value="DRAFT">Em produção</option>
            <option value="PUBLISHED">Publicado</option>
            <option value="UPDATING">Em atualização</option>
            <option value="ARCHIVED">Arquivado</option>
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Publicado em</legend>
          <input type="date" class="input w-full" [formField]="contentForm.publishedAt" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Custo de produção (R$)</legend>
          <input type="number" step="1" class="input w-full" [formField]="contentForm.productionCost" />
          @if (contentForm.productionCost().touched() && contentForm.productionCost().errors().length) {
            <p class="label text-error">{{ contentForm.productionCost().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Objetivo</legend>
          <input type="text" class="input w-full" [placeholder]="'Ex.: ' + brand.examples.contentObjective" [formField]="contentForm.objective" />
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Observações</legend>
          <textarea class="textarea h-20 w-full" [formField]="contentForm.notes"></textarea>
        </fieldset>
        <div class="modal-action sm:col-span-2">
          <button type="button" class="btn btn-ghost" (click)="formOpen.set(false)">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>
    </app-modal>

    <!-- Atualização -->
    <app-modal [(open)]="updateOpen" size="sm">
      @if (updating(); as c) {
        <h3 class="text-lg font-semibold">Registrar atualização</h3>
        <p class="mt-1 text-sm text-base-content/70">{{ c.title }}</p>
        <fieldset class="fieldset mt-3">
          <legend class="fieldset-legend">Data</legend>
          <input type="date" class="input w-full" [value]="updateDate()" (input)="updateDate.set(val($event))" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">O que mudou</legend>
          <textarea class="textarea h-24 w-full" [value]="updateNote()" (input)="updateNote.set(val($event))"></textarea>
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" (click)="updateOpen.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" [disabled]="!updateNote().trim()" (click)="saveUpdate(c)">Salvar</button>
        </div>
      }
    </app-modal>

    <!-- Efeito ao longo do tempo -->
    <app-modal [(open)]="effectOpen" size="lg">
      @if (effectTarget(); as c) {
        <h3 class="flex items-center gap-2 text-lg font-semibold"><app-icon name="trend-up" /> Efeito ao longo do tempo</h3>
        <p class="mt-1 text-sm text-base-content/70">{{ c.title }}</p>

        @if (!siteConfigured()) {
          <div role="note" class="alert alert-soft mt-4">
            <app-icon name="info" />
            <span class="text-sm">
              Para medir o efeito, conecte o Search Console em Configurações. Sem ele, o painel só registra as
              datas e não afirma nada sobre resultado.
            </span>
          </div>
        } @else if (!c.url) {
          <div role="note" class="alert alert-soft mt-4">
            <app-icon name="info" />
            <span class="text-sm">Informe a URL do conteúdo para medir o efeito.</span>
          </div>
        } @else if (series.isLoading()) {
          <div class="mt-4 flex items-center gap-2 text-sm"><span class="loading loading-spinner loading-sm"></span> Buscando cliques no Search Console…</div>
        } @else if (series.error(); as err) {
          <div role="alert" class="alert alert-error alert-soft mt-4 text-sm">{{ errorText(err) }}</div>
        } @else if (effectView(); as v) {
          <div class="mt-4 flex flex-wrap items-center gap-4">
            <div class="text-base-content/70">
              <app-sparkline [values]="v.spark" label="Cliques orgânicos por dia" />
              <div class="text-xs">cliques orgânicos por dia</div>
            </div>
            <div class="text-sm text-base-content/70">
              A comparação desconta a variação do <strong>site inteiro</strong> no mesmo período e avisa de outras
              mudanças registradas.
            </div>
          </div>

          <ul class="mt-4 flex flex-col gap-3">
            @for (e of v.events; track e.at + e.label) {
              <li class="rounded-box border border-base-300 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="font-medium">{{ e.label }} <span class="text-base-content/60">· {{ e.at }}</span></div>
                  <app-confidence [level]="e.result.confidence.level" />
                </div>
                <p class="mt-1 text-sm">{{ e.result.note }}</p>
                @if (e.result.lift !== null) {
                  <div class="mt-1 text-xs text-base-content/70">
                    Variação da página: {{ e.result.lift | percent: '1.0-0' }}
                    @if (e.result.controlLift !== null) {
                      · do site inteiro: {{ e.result.controlLift | percent: '1.0-0' }}
                      · da página, descontado o site: {{ e.result.adjustedLift | percent: '1.0-0' }}
                    }
                  </div>
                }
                <ul class="mt-2 list-disc pl-5 text-xs text-base-content/70">
                  @for (r of e.result.confidence.reasons; track r) {
                    <li>{{ r }}</li>
                  }
                </ul>
              </li>
            } @empty {
              <li class="text-sm text-base-content/60">
                Registre a data de publicação ou de uma atualização para medir o efeito.
              </li>
            }
          </ul>
        }
        <div class="modal-action">
          <button type="button" class="btn" (click)="effectOpen.set(false)">Fechar</button>
        </div>
      }
    </app-modal>
  `,
})
export class ContentPage {
  protected readonly brand = BRAND;
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  private readonly store = inject(ContentStore);
  private readonly questionsStore = inject(QuestionsStore);
  private readonly changes = inject(ChangesStore);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly api = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);

  protected readonly intents = INTENTS;
  protected readonly items = computed(() =>
    [...this.store.items()].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')),
  );
  protected readonly questions = computed(() =>
    [...this.questionsStore.items()].sort((a, b) => b.count - a.count),
  );
  protected readonly opportunities = this.insights.contentOpportunities;
  protected readonly organicReady = computed(() => this.ws.searchConsoleStatus().configured);
  protected readonly siteConfigured = computed(() => !!this.cfg.config().searchConsoleSite);

  protected money = (v: number): string => brl(v);

  protected readonly contentKpis = computed(() => {
    const publish = this.opportunities().filter((o) => o.type === 'PUBLISH');
    return {
      publish: publish.length,
      clicks: publish.reduce((s, o) => s + o.demand.clicks, 0),
      cost: publish.reduce((s, o) => s + o.demand.cost, 0),
    };
  });

  protected readonly themeBars = computed<BarItem[]>(() =>
    [...this.opportunities()]
      .sort((a, b) => b.demand.clicks - a.demand.clicks || b.demand.impressions - a.demand.impressions)
      .slice(0, 8)
      .map((o) => ({
        label: o.topic,
        value: o.demand.clicks || o.demand.impressions,
        display: o.demand.clicks ? `${o.demand.clicks} cliques` : `${o.demand.impressions} impressões`,
        tag: TYPE_LABEL[o.type],
        tone: o.type === 'PUBLISH' ? ('warning' as const) : ('info' as const),
        sub: o.demand.cost > 0 ? `${brl(o.demand.cost)} pagos no período` : undefined,
      })),
  );

  protected readonly contentDiagnosis = computed<{ tone: DiagnosisTone; title: string; text: string }>(() => {
    const k = this.contentKpis();
    const top = [...this.opportunities()].sort((a, b) => b.demand.clicks - a.demand.clicks).slice(0, 3);
    if (!this.opportunities().length) {
      return { tone: 'info', title: 'Nenhuma demanda sem conteúdo encontrada', text: 'Com mais buscas no período, ou com o Search Console ligado, as pautas aparecem aqui.' };
    }
    if (k.publish) {
      return {
        tone: 'warn',
        title: 'Há demanda sem conteúdo para atendê-la',
        text: `${k.publish} ${k.publish === 1 ? 'tema procurado não tem' : 'temas procurados não têm'} página que responda. ${k.clicks ? `Você pagou ${k.clicks} cliques (${brl(k.cost)}) nesses temas e eles caem em páginas que não falam do assunto. ` : ''}Principais: ${top.map((o) => o.topic).join(', ')}.`,
      };
    }
    return { tone: 'ok', title: 'Os temas procurados já têm página', text: 'As sugestões abaixo são de atualização e distribuição do que já existe.' };
  });

  protected readonly roleStats = computed(() => {
    const published = this.store.items().filter((c) => c.status === 'PUBLISHED' || c.status === 'UPDATING');
    const by = (r: ContentRole): number => published.filter((c) => c.role === r).length;
    return [
      { role: 'ATTRACT' as const, label: ROLE_LABEL.ATTRACT, count: by('ATTRACT'), help: 'Visitas por informação' },
      { role: 'DECIDE' as const, label: ROLE_LABEL.DECIDE, count: by('DECIDE'), help: 'Comparação e prova' },
      { role: 'CONVERT' as const, label: ROLE_LABEL.CONVERT, count: by('CONVERT'), help: 'Contato e proposta' },
    ];
  });

  constructor() {
    this.insights.needCore();
  }

  protected val(event: Event): never {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value as never;
  }

  protected typeLabel = (t: keyof typeof TYPE_LABEL): string => TYPE_LABEL[t];
  protected typeClass = (t: keyof typeof TYPE_CLASS): string => TYPE_CLASS[t];
  protected roleLabel = (r: ContentRole): string => ROLE_LABEL[r];
  protected intentLabel = (i: SearchIntent): string => INTENT_LABEL[i];
  protected statusLabel = (s: ContentStatus): string => STATUS_LABEL[s];
  protected statusClass = (s: ContentStatus): string => STATUS_CLASS[s];
  protected errorText = (e: unknown): string => describeError(e);

  // ── Registro
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<ContentItem | null>(null);

  private readonly contentValue = signal({
    title: '',
    url: '',
    theme: '',
    audience: '',
    intent: 'COMMERCIAL' as SearchIntent,
    role: 'DECIDE' as ContentRole,
    objective: '',
    status: 'IDEA' as ContentStatus,
    publishedAt: '',
    productionCost: 0,
    notes: '',
  });

  protected readonly contentForm = form(
    this.contentValue,
    (p) => {
      required(p.title, { message: 'Informe o título.' });
      min(p.productionCost, 0, { message: 'Use um valor positivo.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.contentValue();
          const base = {
            title: v.title.trim(),
            url: v.url.trim(),
            theme: v.theme.trim(),
            audience: v.audience.trim(),
            intent: v.intent,
            role: v.role,
            objective: v.objective.trim(),
            status: v.status,
            publishedAt: v.publishedAt || undefined,
            productionCost: v.productionCost > 0 ? v.productionCost : undefined,
            notes: v.notes.trim() || undefined,
          };
          const current = this.editing();
          let saved: ContentItem;
          if (current) {
            saved = { ...current, ...base };
            await this.store.upsert(saved);
          } else {
            saved = await this.store.add({ ...base, updates: [] } as Omit<ContentItem, 'id' | 'accountId'>);
          }
          if (saved.publishedAt) await this.logChange(saved, `content:${saved.id}:pub`, saved.publishedAt, `Publicou "${saved.title}"`);
          this.toast.success('Conteúdo salvo.');
          this.formOpen.set(false);
          return undefined;
        },
      },
    },
  );

  protected openForm(item: ContentItem | null): void {
    this.editing.set(item);
    this.contentValue.set({
      title: item?.title ?? '',
      url: item?.url ?? '',
      theme: item?.theme ?? '',
      audience: item?.audience ?? '',
      intent: item?.intent ?? 'COMMERCIAL',
      role: item?.role ?? 'DECIDE',
      objective: item?.objective ?? '',
      status: item?.status ?? 'IDEA',
      publishedAt: item?.publishedAt ?? '',
      productionCost: item?.productionCost ?? 0,
      notes: item?.notes ?? '',
    });
    this.contentForm().reset();
    this.formOpen.set(true);
  }

  protected async register(o: { topic: string; intent: SearchIntent; role: ContentRole; action: string; matchedUrl?: string }): Promise<void> {
    await this.store.add({
      title: o.topic,
      url: o.matchedUrl ?? '',
      theme: o.topic,
      audience: '',
      intent: o.intent,
      role: o.role,
      objective: o.action,
      status: 'IDEA',
      updates: [],
    } as Omit<ContentItem, 'id' | 'accountId'>);
    this.toast.success('Registrado como ideia.');
  }

  protected async remove(id: string): Promise<void> {
    if (!confirm('Excluir este conteúdo do registro? O histórico de mudanças permanece.')) return;
    await this.store.remove(id);
  }

  private async logChange(item: ContentItem, externalKey: string, at: string, title: string): Promise<void> {
    if (this.changes.items().some((c) => c.externalKey === externalKey)) return;
    await this.changes.add({
      at: `${at.slice(0, 10)}T00:00:00`,
      kind: 'CONTENT',
      title,
      description: item.objective || undefined,
      source: 'MANUAL',
      entity: { type: 'content', id: item.id, label: item.title },
      externalKey,
    } as Omit<ChangeEntry, 'id' | 'accountId'>);
  }

  // ── Atualização
  protected readonly updateOpen = signal(false);
  protected readonly updating = signal<ContentItem | null>(null);
  protected readonly updateDate = signal(today());
  protected readonly updateNote = signal('');

  protected openUpdate(c: ContentItem): void {
    this.updating.set(c);
    this.updateDate.set(today());
    this.updateNote.set('');
    this.updateOpen.set(true);
  }

  protected async saveUpdate(c: ContentItem): Promise<void> {
    const note = this.updateNote().trim();
    const at = this.updateDate() || today();
    const saved = { ...c, updates: [...c.updates, { at, note }], status: c.status === 'IDEA' ? c.status : 'PUBLISHED' as ContentStatus };
    await this.store.upsert(saved);
    await this.logChange(saved, `content:${c.id}:upd:${at}:${c.updates.length}`, at, `Atualizou "${c.title}"`);
    this.toast.success('Atualização registrada no histórico.');
    this.updateOpen.set(false);
  }

  // ── Dúvidas do atendimento
  private readonly questionValue = signal({ question: '', count: 1 });
  protected readonly questionForm = form(
    this.questionValue,
    (p) => {
      required(p.question, { message: 'Escreva a pergunta.' });
      min(p.count, 1, { message: 'Use ao menos 1.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.questionValue();
          await this.questionsStore.add({
            question: v.question.trim(),
            count: Math.max(1, Math.round(v.count)),
            createdAt: today(),
          });
          this.questionValue.set({ question: '', count: 1 });
          this.questionForm().reset();
          return undefined;
        },
      },
    },
  );

  protected async removeQuestion(id: string): Promise<void> {
    await this.questionsStore.remove(id);
  }

  // ── Efeito
  protected readonly effectOpen = signal(false);
  protected readonly effectTarget = signal<ContentItem | null>(null);

  protected showEffect(c: ContentItem): void {
    this.effectTarget.set(c);
    this.effectOpen.set(true);
  }

  protected readonly series = resource({
    params: () => {
      const item = this.effectTarget();
      const site = this.cfg.config().searchConsoleSite;
      return this.effectOpen() && item?.url && site ? { url: item.url, site } : undefined;
    },
    loader: async ({ params }) => {
      const w = this.ws.dailyWindow();
      const [page, siteWide] = await Promise.all([
        firstValueFrom(this.api.searchConsoleSeries(params.site, w, params.url)),
        firstValueFrom(this.api.searchConsoleSeries(params.site, w)),
      ]);
      const toPoints = (rows: Array<{ date: string; clicks: number }>): SeriesPoint[] =>
        rows.map((r) => ({ date: r.date, value: r.clicks }));
      return { status: page.status, page: toPoints(page.rows), site: toPoints(siteWide.rows) };
    },
  });

  protected readonly effectView = computed(() => {
    const item = this.effectTarget();
    const data = this.series.value();
    if (!item || !data) return null;
    if (!data.status.configured) return null;
    const events = [
      ...(item.publishedAt ? [{ at: item.publishedAt, label: 'Publicação' }] : []),
      ...item.updates.map((u) => ({ at: u.at, label: `Atualização: ${u.note}` })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    const otherChanges = this.changes.items().filter((c) => c.entity?.id !== item.id);
    return {
      spark: data.page.slice(-60).map((p) => p.value),
      events: events.map((e) => ({
        ...e,
        result: evaluateSeriesChange(data.page, data.site, e.at, {
          confounders: otherChanges.filter((c) => Math.abs((new Date(c.at).getTime() - new Date(e.at).getTime()) / 86_400_000) <= 14),
        }),
      })),
    };
  });

}
