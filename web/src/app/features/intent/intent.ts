import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, max, min, required } from '@angular/forms/signals';
import { ChangesStore, HypothesesStore, LearningsStore } from '../../core/collections';
import { Insights } from '../../core/insights';
import { PageAudits } from '../../core/page-audits';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { today } from '../../domain/dates';
import { evaluateChange } from '../../domain/effects';
import { pct } from '../../domain/format';
import { INTENT_LABEL, LOW_COHERENCE, PageRecommendation } from '../../domain/intent';
import {
  ChangeEntry,
  Hypothesis,
  HypothesisMethod,
  HypothesisStatus,
  LearningVerdict,
  SearchIntent,
} from '../../domain/models';
import { PageFinding } from '../../domain/recommendations';
import { sampleSizePerVariant } from '../../domain/stats';
import { VerdictBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { Icon } from '../../shared/icon';
import { AppModal } from '../../shared/modal';
import { PageHeader } from '../../shared/page-header';

const REC_LABEL: Record<PageRecommendation['kind'], string> = {
  KEEP: 'Página adequada',
  REDIRECT: 'Trocar de página',
  CREATE: 'Criar página',
  UNKNOWN: 'Sem como medir',
};

const REC_CLASS: Record<PageRecommendation['kind'], string> = {
  KEEP: 'badge badge-soft badge-success badge-sm',
  REDIRECT: 'badge badge-soft badge-warning badge-sm',
  CREATE: 'badge badge-soft badge-error badge-sm',
  UNKNOWN: 'badge badge-dash badge-sm',
};

const STATUS_LABEL: Record<HypothesisStatus, string> = {
  DRAFT: 'Rascunho',
  RUNNING: 'No ar',
  CONCLUDED: 'Concluída',
  ABORTED: 'Abandonada',
};

const STATUS_CLASS: Record<HypothesisStatus, string> = {
  DRAFT: 'badge badge-soft badge-sm',
  RUNNING: 'badge badge-soft badge-info badge-sm',
  CONCLUDED: 'badge badge-soft badge-success badge-sm',
  ABORTED: 'badge badge-ghost badge-sm',
};

@Component({
  selector: 'app-intent-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    PercentPipe,
    AppModal,
    DataState,
    FormField,
    FormRoot,
    Icon,
    PageHeader,
    VerdictBadge,
  ],
  template: `
    <app-page-header
      group="Inteligência"
      title="Intenção e páginas"
      subtitle="O que a pessoa buscou, o que o anúncio prometeu e o que a página entrega. Mudanças de URL são tratadas como hipóteses: medimos antes e depois, nunca por suposição."
    />

    <app-data-state
      [loading]="insights.loadingCore()"
      [error]="insights.coreError()"
      [hasData]="!!insights.funnel()"
      (retry)="ws.reloadAll()"
    >
      <div class="flex flex-col gap-block">
        <!-- Páginas de destino -->
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="card-title text-base"><app-icon name="link" size="sm" /> Páginas que recebem tráfego pago</h2>
                <p class="max-w-3xl text-sm text-base-content/70">
                  Leia as páginas para checar medição, formulário e botões de contato, e para medir a aderência
                  com o que foi buscado.
                </p>
              </div>
              <button
                type="button"
                class="btn btn-sm"
                [disabled]="audits.running().size > 0 || !pageRows().length"
                (click)="auditAll()"
              >
                @if (audits.running().size > 0) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  <app-icon name="eye" size="sm" />
                }
                Ler todas
              </button>
            </div>

            @if (audits.lastError(); as e) {
              <div role="alert" class="alert alert-warning alert-soft text-sm">{{ e }}</div>
            }

            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Página</th>
                    <th class="text-right">Custo</th>
                    <th class="text-right">Cliques</th>
                    <th class="text-right">Conv.</th>
                    <th>O que a leitura encontrou</th>
                    <th>Veredito</th>
                    <th><span class="sr-only">Ação</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of pageRows(); track p.key) {
                    <tr class="hover:bg-base-200/60">
                      <td class="max-w-72">
                        <div class="truncate font-medium" [attr.title]="p.url">{{ p.label }}</div>
                        <div class="text-xs text-base-content/60">{{ p.campaigns }} campanha(s)</div>
                      </td>
                      <td class="text-right tabular">{{ p.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                      <td class="text-right tabular">{{ p.clicks | number: '1.0-0' }}</td>
                      <td class="text-right tabular">{{ p.conversions | number: '1.0-1' }}</td>
                      <td class="text-xs">
                        @if (p.audit; as a) {
                          @if (a.ok) {
                            <div class="flex flex-wrap gap-1">
                              <span class="badge badge-soft badge-sm" [class.badge-success]="a.forms + a.whatsappLinks + a.telLinks > 0" [class.badge-error]="a.forms + a.whatsappLinks + a.telLinks === 0">
                                {{ a.forms }} formulário · {{ a.whatsappLinks }} WhatsApp · {{ a.telLinks }} telefone
                              </span>
                              <span class="badge badge-soft badge-sm" [class.badge-success]="a.trackingTags.length > 0" [class.badge-warning]="a.trackingTags.length === 0">
                                {{ a.trackingTags.length ? a.trackingTags.join(', ') : 'sem etiqueta de medição' }}
                              </span>
                              @if (a.responseMs) {
                                <span class="badge badge-ghost badge-sm">{{ a.responseMs / 1000 | number: '1.1-1' }} s</span>
                              }
                            </div>
                            @if (a.title) {
                              <div class="mt-1 truncate text-base-content/60" [attr.title]="a.title">{{ a.title }}</div>
                            }
                          } @else {
                            <span class="text-error">{{ a.error ?? 'Falhou' }}</span>
                          }
                        } @else {
                          <span class="text-base-content/50">Ainda não lida</span>
                        }
                      </td>
                      <td>
                        @if (p.verdict) {
                          <app-verdict [verdict]="p.verdict" />
                        }
                      </td>
                      <td class="whitespace-nowrap">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          [disabled]="audits.isRunning(p.url)"
                          (click)="audits.audit(p.url, true)"
                        >
                          @if (audits.isRunning(p.url)) {
                            <span class="loading loading-spinner loading-xs"></span>
                          } @else {
                            Ler
                          }
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="7" class="py-8 text-center text-base-content/60">Nenhuma página com cliques no período.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Assuntos de busca -->
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div>
              <h2 class="card-title text-base"><app-icon name="search" size="sm" /> Assuntos de busca e a página ideal</h2>
              <p class="max-w-3xl text-sm text-base-content/70">
                Buscas parecidas foram agrupadas por assunto. Para cada grupo comparamos o que foi buscado com o
                texto das páginas conhecidas. A aderência é uma estimativa por palavras: confirme lendo a página.
              </p>
            </div>

            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Assunto</th>
                    <th>Intenção</th>
                    <th class="text-right">Custo</th>
                    <th class="text-right">Cliques</th>
                    <th class="text-right">Conv.</th>
                    <th class="text-right">Aderência</th>
                    <th>Recomendação</th>
                    <th><span class="sr-only">Ação</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of findings(); track f.cluster.id) {
                    <tr class="hover:bg-base-200/60 align-top">
                      <td class="max-w-72">
                        <div class="font-medium break-words">{{ f.cluster.label }}</div>
                        <div class="text-xs text-base-content/60">
                          {{ f.cluster.terms.length }} busca(s) · {{ f.cluster.topics.join(' · ') }}
                        </div>
                      </td>
                      <td class="text-xs">{{ intentLabel(f.cluster.intent) }}</td>
                      <td class="text-right tabular">{{ f.cluster.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                      <td class="text-right tabular">{{ f.cluster.clicks | number: '1.0-0' }}</td>
                      <td class="text-right tabular">{{ f.cluster.conversions | number: '1.0-1' }}</td>
                      <td class="text-right tabular">
                        @if (f.coherence !== null) {
                          <span [class]="f.coherence < lowCoherence ? 'text-error' : ''">{{ f.coherence | percent: '1.0-0' }}</span>
                        } @else {
                          <span class="text-base-content/40" title="Página sem texto conhecido: leia a página">—</span>
                        }
                      </td>
                      <td class="max-w-72">
                        <span [class]="recClass(f.recommendation.kind)">{{ recLabel(f.recommendation.kind) }}</span>
                        <div class="mt-1 text-xs text-base-content/70">
                          @switch (f.recommendation.kind) {
                            @case ('REDIRECT') {
                              Levar para
                              <span class="font-mono break-all">{{ shortUrl(f.recommendation.best?.url) }}</span>
                              ({{ f.recommendation.bestScore | percent: '1.0-0' }} do assunto)
                            }
                            @case ('CREATE') {
                              Nenhuma página cobre "{{ f.recommendation.suggestedTitle }}".
                            }
                            @case ('KEEP') {
                              {{ shortUrl(f.currentUrls[0]) }}
                            }
                            @default {
                              {{ f.recommendation.note }}
                            }
                          }
                        </div>
                      </td>
                      <td class="whitespace-nowrap">
                        @if (f.recommendation.kind === 'REDIRECT' || f.recommendation.kind === 'CREATE') {
                          <button type="button" class="btn btn-xs" (click)="openHypothesis(f)">
                            <app-icon name="beaker" size="xs" /> Testar
                          </button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="8" class="py-8 text-center text-base-content/60">
                        Sem termos suficientes para agrupar por assunto neste período.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Hipóteses -->
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="card-title text-base"><app-icon name="beaker" size="sm" /> Hipóteses e testes</h2>
                <p class="max-w-3xl text-sm text-base-content/70">
                  Cada mudança de URL entra aqui como uma hipótese com data de início. O resultado é medido por
                  comparação antes e depois, com aviso de outras mudanças no mesmo período.
                </p>
              </div>
              <button type="button" class="btn btn-sm" (click)="openHypothesis(null)">
                <app-icon name="plus" size="sm" /> Nova hipótese
              </button>
            </div>

            <div class="grid gap-block lg:grid-cols-2">
              @for (h of hypothesisViews(); track h.item.id) {
                <article class="card card-border bg-base-100">
                  <div class="card-body gap-3 p-4">
                    <div class="flex items-start justify-between gap-2">
                      <h3 class="font-semibold break-words">{{ h.item.title }}</h3>
                      <span [class]="statusClass(h.item.status)">{{ statusLabel(h.item.status) }}</span>
                    </div>
                    <p class="text-sm text-base-content/70">{{ h.item.statement }}</p>

                    @if (h.item.fromUrl || h.item.toUrl) {
                      <div class="text-xs">
                        <div><span class="text-base-content/60">De:</span> <span class="font-mono break-all">{{ h.item.fromUrl || '—' }}</span></div>
                        <div><span class="text-base-content/60">Para:</span> <span class="font-mono break-all">{{ h.item.toUrl || '—' }}</span></div>
                      </div>
                    }

                    @if (h.effect; as e) {
                      <div class="rounded-box bg-base-200 p-3 text-sm">
                        @switch (e.verdict) {
                          @case ('WAITING') {
                            <strong>Aguardando dados.</strong> {{ e.note }}
                          }
                          @case ('IMPROVED') {
                            <strong class="text-success">Melhorou.</strong> {{ e.note }}
                            @if (e.rateLift !== null) {
                              Taxa de conversão {{ e.rateLift | percent: '1.0-0' }} vs. antes.
                            }
                          }
                          @case ('WORSENED') {
                            <strong class="text-error">Piorou.</strong> {{ e.note }}
                            @if (e.rateLift !== null) {
                              Taxa de conversão {{ e.rateLift | percent: '1.0-0' }} vs. antes.
                            }
                          }
                          @default {
                            <strong>Sem efeito claro.</strong> {{ e.note }}
                          }
                        }
                        @if (e.confounders.length) {
                          <div class="mt-1 text-xs text-warning">
                            {{ e.confounders.length }} outra(s) mudança(s) no período: a atribuição é incerta.
                          </div>
                        }
                      </div>
                    }

                    <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
                      <span>{{ h.item.method === 'EXPERIMENT' ? 'Experimento A/B' : 'Antes e depois' }}</span>
                      <span>· melhora mínima de {{ h.item.minLiftPct }}%</span>
                      @if (h.item.startedAt) {
                        <span>· no ar desde {{ h.item.startedAt }}</span>
                      }
                    </div>

                    <div class="card-actions justify-end">
                      @if (h.item.status === 'DRAFT') {
                        <button type="button" class="btn btn-xs" (click)="start(h.item)">Já está no ar (hoje)</button>
                      }
                      @if (h.item.status === 'RUNNING') {
                        <button type="button" class="btn btn-xs" (click)="openConclude(h.item)">Concluir</button>
                      }
                      <button type="button" class="btn btn-ghost btn-xs text-error" (click)="removeHypothesis(h.item.id)">
                        Excluir
                      </button>
                    </div>
                  </div>
                </article>
              } @empty {
                <div class="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/70 lg:col-span-2">
                  Nenhuma hipótese ainda. Use "Testar" nas recomendações acima ou crie uma nova.
                </div>
              }
            </div>
          </div>
        </section>
      </div>
    </app-data-state>

    <!-- Nova hipótese -->
    <app-modal [(open)]="hypothesisOpen" size="lg">
      <h3 class="flex items-center gap-2 text-lg font-semibold"><app-icon name="beaker" /> Nova hipótese</h3>
      <form [formRoot]="hypothesisForm" class="mt-4 grid gap-3 sm:grid-cols-2">
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Título</legend>
          <input type="text" class="input w-full" [formField]="hypothesisForm.title" />
          @if (hypothesisForm.title().touched() && hypothesisForm.title().errors().length) {
            <p class="label text-error">{{ hypothesisForm.title().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Hipótese (se… então… porque…)</legend>
          <textarea class="textarea h-24 w-full" [formField]="hypothesisForm.statement"></textarea>
          @if (hypothesisForm.statement().touched() && hypothesisForm.statement().errors().length) {
            <p class="label text-error">{{ hypothesisForm.statement().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">URL atual</legend>
          <input type="text" class="input w-full font-mono text-xs" [formField]="hypothesisForm.fromUrl" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">URL nova</legend>
          <input type="text" class="input w-full font-mono text-xs" [formField]="hypothesisForm.toUrl" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Campanha medida</legend>
          <select class="select w-full" [formField]="hypothesisForm.campaignId">
            <option value="">Conta inteira</option>
            @for (c of campaigns(); track c.id) {
              <option [value]="c.id">{{ c.name }}</option>
            }
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Melhora mínima que vale detectar (%)</legend>
          <input type="number" class="input w-full" [formField]="hypothesisForm.minLiftPct" />
          @if (hypothesisForm.minLiftPct().touched() && hypothesisForm.minLiftPct().errors().length) {
            <p class="label text-error">{{ hypothesisForm.minLiftPct().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Como medir</legend>
          <select class="select w-full" [formField]="hypothesisForm.method">
            <option value="BEFORE_AFTER">Comparar antes e depois da troca</option>
            <option value="EXPERIMENT">Experimento A/B no Google Ads (50/50)</option>
          </select>
        </fieldset>

        <div class="rounded-box bg-base-200 p-3 text-sm sm:col-span-2">
          @if (viability(); as v) {
            <div class="font-medium">Dá para testar?</div>
            <p class="mt-1">
              Com cerca de {{ v.dailyClicks | number: '1.0-0' }} cliques por dia e taxa de conversão de
              {{ v.rate | percent: '1.0-1' }}, detectar uma melhora de {{ v.lift }}% exige
              ~{{ v.perVariant | number: '1.0-0' }} cliques por versão.
              @if (v.days !== null) {
                Em um experimento 50/50, isso leva cerca de <strong>{{ v.days }} dias</strong>.
                @if (v.days <= 45) {
                  É viável como experimento.
                } @else {
                  É demorado: prefira antes e depois, sabendo que ele é menos conclusivo.
                }
              }
            </p>
          } @else {
            <p>Escolha uma campanha com conversões para estimar quanto tempo um teste levaria.</p>
          }
        </div>

        <div class="modal-action sm:col-span-2">
          <button type="button" class="btn btn-ghost" (click)="hypothesisOpen.set(false)">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar hipótese</button>
        </div>
      </form>
    </app-modal>

    <!-- Concluir -->
    <app-modal [(open)]="concludeOpen" size="md">
      @if (concluding(); as h) {
        <h3 class="text-lg font-semibold">Concluir: {{ h.title }}</h3>
        <p class="mt-1 text-sm text-base-content/70">
          O que você aprendeu fica guardado em "Histórico e aprendizado".
        </p>
        <fieldset class="fieldset mt-3">
          <legend class="fieldset-legend">Resultado</legend>
          <select class="select w-full" [value]="concludeVerdict()" (change)="concludeVerdict.set(val($event))">
            <option value="CONFIRMED">Confirmada: melhorou</option>
            <option value="REFUTED">Refutada: não melhorou ou piorou</option>
            <option value="INCONCLUSIVE">Inconclusiva: sem dados suficientes</option>
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">O que aprendemos</legend>
          <textarea class="textarea h-24 w-full" [value]="concludeNote()" (input)="concludeNote.set(val($event))"></textarea>
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" (click)="concludeOpen.set(false)">Cancelar</button>
          <button type="button" class="btn btn-primary" (click)="conclude(h)">Salvar aprendizado</button>
        </div>
      }
    </app-modal>
  `,
})
export class IntentPage {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  protected readonly audits = inject(PageAudits);
  private readonly hypotheses = inject(HypothesesStore);
  private readonly changes = inject(ChangesStore);
  private readonly learnings = inject(LearningsStore);
  private readonly toast = inject(ToastService);

  protected readonly lowCoherence = LOW_COHERENCE;
  protected readonly campaigns = computed(() => this.ws.campaigns.value() ?? []);
  protected readonly findings = computed<PageFinding[]>(() => this.insights.pageFindings());

  // ── Páginas
  protected readonly pageRows = computed(() => {
    const byKey = new Map<
      string,
      { key: string; url: string; label: string; cost: number; clicks: number; conversions: number; campaigns: Set<string> }
    >();
    for (const p of this.ws.landingPages.value() ?? []) {
      const e = byKey.get(p.normalizedUrl) ?? {
        key: p.normalizedUrl,
        url: /^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`,
        label: p.url.replace(/^https?:\/\//, ''),
        cost: 0,
        clicks: 0,
        conversions: 0,
        campaigns: new Set<string>(),
      };
      e.cost += p.cost;
      e.clicks += p.clicks;
      e.conversions += p.conversions;
      e.campaigns.add(p.campaignId);
      byKey.set(p.normalizedUrl, e);
    }
    const verdicts = new Map(this.insights.wastePages().map((r) => [r.key, r.assessment.verdict]));
    return Array.from(byKey.values())
      .map((e) => ({
        ...e,
        campaigns: e.campaigns.size,
        audit: this.audits.get(e.url),
        verdict: verdicts.get(e.key),
      }))
      .sort((a, b) => b.cost - a.cost);
  });

  protected async auditAll(): Promise<void> {
    await this.audits.auditMany(this.pageRows().map((p) => p.url));
  }

  protected recLabel = (k: PageRecommendation['kind']): string => REC_LABEL[k];
  protected recClass = (k: PageRecommendation['kind']): string => REC_CLASS[k];
  protected intentLabel = (i: SearchIntent): string => INTENT_LABEL[i];
  protected statusLabel = (s: HypothesisStatus): string => STATUS_LABEL[s];
  protected statusClass = (s: HypothesisStatus): string => STATUS_CLASS[s];
  protected shortUrl(url: string | undefined): string {
    return url ? url.replace(/^https?:\/\/(www\.)?/, '') : '—';
  }
  protected val(event: Event): never {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value as never;
  }

  // ── Hipóteses
  protected readonly hypothesisViews = computed(() =>
    [...this.hypotheses.items()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => ({
        item,
        effect:
          item.status === 'RUNNING' && item.startedAt
            ? evaluateChange(
                {
                  id: item.id,
                  accountId: item.accountId,
                  at: item.startedAt,
                  kind: 'URL',
                  title: item.title,
                  source: 'MANUAL',
                  campaignId: item.campaignId || undefined,
                } as ChangeEntry,
                this.ws.daily.value() ?? [],
                this.changes.items(),
              )
            : null,
      })),
  );

  protected readonly hypothesisOpen = signal(false);
  private readonly hypothesisValue = signal({
    title: '',
    statement: '',
    fromUrl: '',
    toUrl: '',
    campaignId: '',
    minLiftPct: 20,
    method: 'BEFORE_AFTER' as HypothesisMethod,
  });

  protected readonly hypothesisForm = form(
    this.hypothesisValue,
    (p) => {
      required(p.title, { message: 'Dê um título à hipótese.' });
      required(p.statement, { message: 'Descreva a hipótese: se…, então…, porque…' });
      min(p.minLiftPct, 1, { message: 'Use ao menos 1%.' });
      max(p.minLiftPct, 500, { message: 'Use até 500%.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.hypothesisValue();
          const campaign = this.campaigns().find((c) => c.id === v.campaignId);
          await this.hypotheses.add({
            createdAt: new Date().toISOString().slice(0, 10),
            kind: 'LANDING_URL',
            title: v.title.trim(),
            statement: v.statement.trim(),
            fromUrl: v.fromUrl.trim() || undefined,
            toUrl: v.toUrl.trim() || undefined,
            campaignId: v.campaignId || undefined,
            method: v.method,
            status: 'DRAFT',
            minLiftPct: v.minLiftPct,
            baseline: campaign
              ? {
                  from: this.insights.window().from,
                  to: this.insights.window().to,
                  perf: {
                    impressions: campaign.impressions,
                    clicks: campaign.clicks,
                    cost: campaign.cost,
                    conversions: campaign.conversions,
                  },
                }
              : undefined,
          } as Omit<Hypothesis, 'id' | 'accountId'>);
          this.toast.success('Hipótese salva. Quando a mudança entrar no ar, marque "Já está no ar".');
          this.hypothesisOpen.set(false);
          return undefined;
        },
      },
    },
  );

  protected readonly viability = computed(() => {
    const v = this.hypothesisValue();
    const c = this.campaigns().find((x) => x.id === v.campaignId);
    const clicks = c?.clicks ?? this.campaigns().reduce((s, x) => s + x.clicks, 0);
    const conv = c?.conversions ?? this.campaigns().reduce((s, x) => s + x.conversions, 0);
    if (clicks <= 0 || conv <= 0) return null;
    const rate = conv / clicks;
    const dailyClicks = clicks / this.insights.window().days;
    const perVariant = sampleSizePerVariant(rate, v.minLiftPct / 100);
    const days = Number.isFinite(perVariant) && dailyClicks > 0 ? Math.ceil((perVariant * 2) / dailyClicks) : null;
    return { rate, dailyClicks, perVariant, lift: v.minLiftPct, days };
  });

  protected openHypothesis(f: PageFinding | null): void {
    if (f) {
      const best = f.recommendation.best?.url ?? '';
      const from = f.currentUrls[0] ?? '';
      const campaignId = this.dominantCampaign(f);
      this.hypothesisValue.set({
        title:
          f.recommendation.kind === 'CREATE'
            ? `Criar página para "${f.cluster.label}"`
            : `Levar buscas de "${f.cluster.label}" para uma página mais específica`,
        statement:
          f.recommendation.kind === 'CREATE'
            ? `Se criarmos uma página dedicada a "${f.recommendation.suggestedTitle ?? f.cluster.label}" e a usarmos como destino, a taxa de conversão desse assunto sobe, porque hoje nenhuma página cobre o que as pessoas buscam.`
            : `Se os anúncios sobre "${f.cluster.label}" apontarem para ${this.shortUrl(best)} em vez de ${this.shortUrl(from)}, a taxa de conversão sobe, porque a página cobre ${pct(f.recommendation.bestScore, 0)} do assunto buscado.`,
        fromUrl: from,
        toUrl: f.recommendation.kind === 'CREATE' ? '' : best,
        campaignId,
        minLiftPct: 20,
        method: 'BEFORE_AFTER',
      });
    } else {
      this.hypothesisValue.set({
        title: '',
        statement: '',
        fromUrl: '',
        toUrl: '',
        campaignId: '',
        minLiftPct: 20,
        method: 'BEFORE_AFTER',
      });
    }
    this.hypothesisForm().reset();
    this.hypothesisOpen.set(true);
  }

  private dominantCampaign(f: PageFinding): string {
    const cost = new Map<string, number>();
    for (const t of f.cluster.terms) cost.set(t.campaignId, (cost.get(t.campaignId) ?? 0) + t.cost);
    return Array.from(cost.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }

  protected async start(h: Hypothesis): Promise<void> {
    const startedAt = today();
    await this.hypotheses.upsert({ ...h, status: 'RUNNING', startedAt });
    await this.changes.add({
      at: `${startedAt}T00:00:00`,
      kind: 'URL',
      title: `Mudança de URL: ${h.title}`,
      description: `${h.statement}${h.fromUrl ? ` De ${h.fromUrl}` : ''}${h.toUrl ? ` para ${h.toUrl}.` : ''}`,
      source: 'MANUAL',
      campaignId: h.campaignId || undefined,
      entity: { type: 'hypothesis', id: h.id, label: h.title },
      expected: `Taxa de conversão ao menos ${h.minLiftPct}% maior.`,
    } as Omit<ChangeEntry, 'id' | 'accountId'>);
    this.toast.success('Registrado no histórico. O efeito aparece depois de alguns dias.');
  }

  protected async removeHypothesis(id: string): Promise<void> {
    await this.hypotheses.remove(id);
  }

  // ── Conclusão
  protected readonly concludeOpen = signal(false);
  protected readonly concluding = signal<Hypothesis | null>(null);
  protected readonly concludeVerdict = signal<LearningVerdict>('INCONCLUSIVE');
  protected readonly concludeNote = signal('');

  protected openConclude(h: Hypothesis): void {
    const effect = this.hypothesisViews().find((v) => v.item.id === h.id)?.effect;
    this.concluding.set(h);
    this.concludeVerdict.set(
      effect?.verdict === 'IMPROVED' ? 'CONFIRMED' : effect?.verdict === 'WORSENED' ? 'REFUTED' : 'INCONCLUSIVE',
    );
    this.concludeNote.set(effect ? `${effect.note}` : '');
    this.concludeOpen.set(true);
  }

  protected async conclude(h: Hypothesis): Promise<void> {
    const note = this.concludeNote().trim();
    await this.hypotheses.upsert({ ...h, status: 'CONCLUDED', conclusion: note });
    await this.learnings.add({
      at: new Date().toISOString().slice(0, 10),
      title: h.title,
      insight: note || 'Sem observações.',
      verdict: this.concludeVerdict(),
      tags: ['url', 'página de destino'],
      sourceId: h.id,
    } as never);
    this.toast.success('Aprendizado registrado.');
    this.concludeOpen.set(false);
  }
}
