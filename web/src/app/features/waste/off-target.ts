import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BusinessConfigStore } from '../../core/business-config.store';
import { describeError } from '../../core/dataset';
import { Workspace } from '../../core/workspace';
import { IntegrationsApi } from '../../data/integrations.api';
import { Fact, buildTermReviewFacts } from '../../domain/autofill-facts';
import { brl, num, pct } from '../../domain/format';
import { AiTermVerdict, OffTargetGroup, computeOffTarget, termsForReview } from '../../domain/off-target';
import { Icon } from '../../shared/icon';

const ITEMS_SHOWN = 5;

/**
 * Quanto do gasto foi para termos, regiões e horários que não combinam com o que a pessoa informou.
 * O valor em reais vem de regras e dados da conta; a IA só marca termos "a confirmar", fora da faixa.
 */
@Component({
  selector: 'app-off-target',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <section class="card card-border bg-base-100" data-open-help="desperdicios-fora-do-alvo">
      <div class="card-body gap-4">
        <div>
          <h2 class="card-title text-base"><app-icon name="target" size="sm" /> Entrega fora do alvo</h2>
          <p class="text-sm text-base-content/70">
            O Google decide onde o anúncio aparece sem conhecer o seu negócio. Aqui está o gasto que foi para
            termos, regiões e horários que contrariam o que você informou em Configurações.
          </p>
        </div>

        @if (!ready()) {
          @if (error()) {
            <div role="alert" class="alert alert-error alert-soft">
              <app-icon name="warning" />
              <span class="text-sm">Não foi possível ler os dados: {{ error() }}</span>
            </div>
          } @else {
            <p class="flex items-center gap-2 text-sm text-base-content/70">
              <span class="loading loading-spinner loading-sm"></span> Lendo termos, regiões e horários…
            </p>
          }
        } @else if (report(); as r) {
          @if (r.ceiling > 0) {
            <div>
              <p class="text-2xl font-semibold tabular">
                {{ money(r.floor) }}<span class="text-base-content/50"> a </span>{{ money(r.ceiling) }}
              </p>
              <p class="text-sm text-base-content/70">
                @if (r.floorShare !== null && r.ceilingShare !== null) {
                  {{ pct(r.floorShare) }} a {{ pct(r.ceilingShare) }} do gasto do período.
                }
                É uma faixa porque um mesmo clique pode estar em mais de um recorte (por exemplo, numa região fora da
                área e num termo ruim): o menor valor é o maior recorte, o maior é a soma deles.
              </p>
            </div>
          } @else {
            <p class="text-sm">Nada fora do alvo foi encontrado com as regras e a área informadas.</p>
          }

          <div class="grid gap-3 lg:grid-cols-3">
            @for (g of r.groups; track g.kind) {
              <article class="rounded-box border border-base-300 p-3">
                <h3 class="text-sm font-semibold">{{ g.title }}</h3>
                <p class="text-lg font-semibold tabular">{{ money(g.cost) }}</p>
                <p class="text-xs text-base-content/60">{{ num(g.clicks) }} cliques, {{ conversions(g.conversions) }}</p>
                <ul class="mt-2 flex flex-col gap-2">
                  @for (i of shown(g); track i.id) {
                    <li class="text-xs">
                      <div class="flex justify-between gap-2">
                        <strong class="min-w-0 break-words">{{ i.label }}</strong>
                        <span class="tabular">{{ money(i.cost) }}</span>
                      </div>
                      <p class="text-base-content/60">{{ i.rule }}</p>
                      @if (i.conversions > 0) {
                        <p class="text-warning">Teve {{ conversions(i.conversions) }}: revise antes de agir.</p>
                      }
                    </li>
                  } @empty {
                    <li class="text-xs text-base-content/60">Nada encontrado neste recorte.</li>
                  }
                </ul>
                @if (g.items.length > shownCount) {
                  <p class="mt-1 text-xs text-base-content/60">e mais {{ g.items.length - shownCount }} no mesmo recorte.</p>
                }
              </article>
            }
          </div>

          @for (n of r.notes; track n) {
            <p class="text-xs text-base-content/70">
              <app-icon name="info" size="xs" /> {{ n }} <a routerLink="/configuracoes" class="link">Abrir Configurações</a>
            </p>
          }

          <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-semibold">Termos a confirmar (IA)</h3>
                <p class="text-xs text-base-content/70">
                  A IA compara os {{ reviewCount() }} termos que mais gastaram sem converter com o seu contexto. Cada
                  apontamento cita o que o termo contraria. Eles não entram na faixa acima até você confirmar.
                </p>
              </div>
              <button type="button" class="btn btn-sm" [disabled]="!canAsk() || busy()" (click)="ask()">
                @if (busy()) { <span class="loading loading-spinner loading-xs"></span> } @else { <app-icon name="sparkles" size="sm" /> }
                Avaliar com IA
              </button>
            </div>
            @if (!hasContext()) {
              <p class="mt-2 text-xs text-warning">
                Preencha ao menos "O que você vende" em
                <a routerLink="/configuracoes" class="link">Configurações</a> para a IA ter com o que comparar.
              </p>
            } @else if (!reviewCount()) {
              <p class="mt-2 text-xs text-base-content/60">Nenhum termo elegível: todos já têm regra, negativa ou conversão.</p>
            }
            @if (note()) {
              <p class="mt-2 text-xs text-base-content/70">{{ note() }}</p>
            }
            @if (r.toConfirm.items.length) {
              <p class="mt-2 text-sm font-medium">
                {{ r.toConfirm.items.length }} {{ r.toConfirm.items.length === 1 ? 'termo' : 'termos' }}, {{ money(r.toConfirm.cost) }} a confirmar
              </p>
              <ul class="mt-1 flex flex-col gap-2">
                @for (i of r.toConfirm.items; track i.id) {
                  <li class="rounded-box bg-base-100 p-2 text-xs">
                    <div class="flex justify-between gap-2">
                      <strong class="min-w-0 break-words">{{ i.label }}</strong>
                      <span class="tabular">{{ money(i.cost) }}</span>
                    </div>
                    <p>{{ i.rule }}</p>
                    <p class="text-base-content/60">Baseado em: {{ evidenceText(i.evidence) }}</p>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class OffTarget {
  private readonly ws = inject(Workspace);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly api = inject(IntegrationsApi);

  protected readonly shownCount = ITEMS_SHOWN;
  protected readonly money = brl;
  protected readonly num = num;
  protected readonly pct = (v: number): string => pct(v, 0);
  protected readonly conversions = (v: number): string => `${num(v, 1)} ${v === 1 ? 'conversão' : 'conversões'}`;

  private readonly datasets = [this.ws.campaigns, this.ws.searchTermsRaw, this.ws.negatives, this.ws.regions, this.ws.hours];

  protected readonly error = computed(() => this.datasets.map((d) => d.error()).find((e) => e) ?? null);
  protected readonly ready = computed(() => this.datasets.every((d) => d.value() !== undefined));

  private readonly verdicts = signal<AiTermVerdict[]>([]);
  private readonly facts = signal<Fact[]>([]);
  protected readonly busy = signal(false);
  protected readonly note = signal('');

  protected readonly report = computed(() => {
    if (!this.ready()) return null;
    const c = this.cfg.config();
    return computeOffTarget({
      terms: this.ws.terms(),
      regions: this.ws.regions.value() ?? [],
      hours: this.ws.hours.value() ?? [],
      serviceArea: c.serviceArea,
      serviceHours: c.serviceHours,
      periodCost: (this.ws.campaigns.value() ?? []).reduce((s, x) => s + x.cost, 0),
      ai: this.verdicts(),
    });
  });

  protected readonly reviewTerms = computed(() => (this.ready() ? termsForReview(this.ws.terms()) : []));
  protected readonly reviewCount = computed(() => this.reviewTerms().length);
  protected readonly hasContext = computed(() => this.cfg.config().context.offer.trim().length > 0);
  protected readonly canAsk = computed(() => this.hasContext() && this.reviewCount() > 0);

  constructor() {
    for (const d of this.datasets) d.need();
  }

  protected shown(g: OffTargetGroup) {
    return g.items.slice(0, ITEMS_SHOWN);
  }

  protected evidenceText(ids: readonly string[]): string {
    const byId = new Map(this.facts().map((f) => [f.id, f.text]));
    return ids.map((id) => byId.get(id) ?? id).join('; ');
  }

  protected async ask(): Promise<void> {
    if (!this.canAsk() || this.busy()) return;
    const terms = this.reviewTerms();
    const facts = buildTermReviewFacts(this.cfg.config().context, terms);
    this.busy.set(true);
    this.note.set('');
    try {
      const res = await firstValueFrom(this.api.autofill({ facts, terms: terms.map((t) => t.term) }));
      if (!res.configured) {
        this.note.set(res.reason ?? 'A IA não está configurada neste servidor. Rode "npm run setup" e informe a chave.');
        return;
      }
      this.facts.set(facts);
      this.verdicts.set(res.termVerdicts ?? []);
      const dropped = res.dropped ? ` ${res.dropped} ${res.dropped === 1 ? 'apontamento foi descartado' : 'apontamentos foram descartados'} por não ${res.dropped === 1 ? 'ter' : 'terem'} base nos seus dados.` : '';
      this.note.set(
        res.reason ??
          ((res.termVerdicts?.length ?? 0) === 0
            ? `Nenhum dos ${terms.length} termos avaliados contraria claramente o seu contexto.${dropped}`
            : `Avaliação concluída.${dropped}`),
      );
    } catch (e) {
      this.note.set(describeError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
