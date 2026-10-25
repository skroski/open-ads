import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AccountStore } from '../../core/account.store';
import { BusinessConfigStore } from '../../core/business-config.store';
import { ChangesStore } from '../../core/collections';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { GoogleAdsApi } from '../../data/google-ads.api';
import { Advice, DimensionReport, SegmentReport, reportDemographics } from '../../domain/demographics';
import { brl, num, pct } from '../../domain/format';
import { ChangeEntry, DemographicDimension } from '../../domain/models';
import { Icon } from '../../shared/icon';

interface Pending {
  dimension: DemographicDimension;
  segment: string;
  label: string;
  change: 'exclude' | 'include';
  adGroups: number;
}

const ADVICE_LABEL: Record<Advice, string> = {
  EXCLUDE_CANDIDATE: 'Candidato a excluir',
  CONVERTS: 'Converte',
  NO_EVIDENCE: 'Sem evidência',
  EXCLUDED: 'Excluído',
};

// Classes escritas por inteiro: o Tailwind só gera o que encontra no código.
const ADVICE_CLASS: Record<Advice, string> = {
  EXCLUDE_CANDIDATE: 'badge badge-warning badge-soft badge-sm whitespace-nowrap',
  CONVERTS: 'badge badge-success badge-soft badge-sm whitespace-nowrap',
  NO_EVIDENCE: 'badge badge-ghost badge-sm whitespace-nowrap',
  EXCLUDED: 'badge badge-neutral badge-soft badge-sm whitespace-nowrap',
};

/**
 * Quem viu os anúncios de Display, por faixa etária, gênero, renda e situação parental, com a opção de excluir
 * ou reincluir um perfil. O painel só recomenda excluir quando os dados sustentam. Toda mudança passa por uma
 * validação no Google (nada é gravado) e só vale depois da sua confirmação.
 */
@Component({
  selector: 'app-display-demographics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (displayCampaigns().length) {
      <section class="card card-border bg-base-100" data-open-help="campanhas-demografia">
        <div class="card-body gap-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="card-title text-base"><app-icon name="users" size="sm" /> Display: quem viu seus anúncios</h2>
              <p class="text-sm text-base-content/70">
                Desempenho real do Google Ads por faixa etária, gênero, renda e situação parental. Excluir um perfil
                impede novas exibições para ele; nada muda sem a sua confirmação.
              </p>
            </div>
            @if (displayCampaigns().length > 1) {
              <select class="select select-sm w-64" aria-label="Campanha de Display" [value]="campaignId()" (change)="pick($event)">
                @for (c of displayCampaigns(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
            }
          </div>

          @if (!loaded()) {
            @if (error()) {
              <div role="alert" class="alert alert-error alert-soft">
                <app-icon name="warning" />
                <span class="text-sm">Não foi possível ler o perfil do público: {{ error() }}</span>
              </div>
            } @else {
              <p class="flex items-center gap-2 text-sm text-base-content/70">
                <span class="loading loading-spinner loading-sm"></span> Lendo o perfil do público…
              </p>
            }
          } @else if (report(); as r) {
            <p class="text-sm">
              <strong>{{ selectedName() }}</strong>: {{ num(r.totals.impressions) }} impressões, {{ num(r.totals.clicks) }} cliques,
              {{ money(r.totals.cost) }} e {{ num(r.totals.conversions, 1) }} conversões no período.
            </p>

            @if (r.noConversions) {
              <div role="status" class="alert alert-info alert-soft">
                <app-icon name="info" />
                <div class="text-sm">
                  <p class="font-medium">Sem conversões, o painel não consegue dizer qual perfil rende mais.</p>
                  <p>
                    Os números abaixo mostram apenas onde o gasto foi. Cortar um perfil só por CTR ou CPC seria chute:
                    clique barato não é resultado. Confira antes se a conversão está sendo medida para o Display.
                  </p>
                </div>
              </div>
            }
            @if (optimized()) {
              <p class="text-xs text-base-content/70">
                <app-icon name="info" size="xs" /> A segmentação otimizada está ligada em {{ optimized() === 1 ? '1 grupo' : optimized() + ' grupos' }}:
                o Google pode alcançar pessoas além das audiências escolhidas.
              </p>
            }

            @for (d of r.dimensions; track d.dimension) {
              @if (d.segments.length) {
                <div>
                  <h3 class="text-sm font-semibold">{{ d.title }}</h3>
                  @if (d.unknownCostShare !== null && d.unknownCostShare >= 0.2) {
                    <p class="text-xs text-warning">{{ pct(d.unknownCostShare) }} do gasto foi para "desconhecido": o Google não sabe quem viu.</p>
                  }
                  <div class="overflow-x-auto">
                    <table class="table table-sm">
                      <thead>
                        <tr>
                          <th>Perfil</th>
                          <th class="text-right">Impressões</th>
                          <th class="text-right">Cliques</th>
                          <th class="text-right">Custo</th>
                          <th class="text-right">% do gasto</th>
                          <th class="text-right">CTR</th>
                          <th class="text-right">CPC</th>
                          <th class="text-right">Conv.</th>
                          <th>Leitura</th>
                          <th><span class="sr-only">Ação</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (s of d.segments; track s.segment) {
                          <tr>
                            <td class="whitespace-nowrap">{{ s.label }}@if (s.partlyExcluded) { <span class="text-xs text-base-content/60"> (excluído em parte)</span> }</td>
                            <td class="text-right tabular">{{ num(s.perf.impressions) }}</td>
                            <td class="text-right tabular">{{ num(s.perf.clicks) }}</td>
                            <td class="text-right tabular">{{ money(s.perf.cost) }}</td>
                            <td class="text-right tabular">{{ s.costShare === null ? '—' : pct(s.costShare) }}</td>
                            <td class="text-right tabular">{{ s.ctr === null ? '—' : pct(s.ctr, 2) }}</td>
                            <td class="text-right tabular">{{ s.cpc === null ? '—' : money(s.cpc) }}</td>
                            <td class="text-right tabular">{{ num(s.perf.conversions, 1) }}</td>
                            <td>
                              <span [class]="adviceClass(s)" [title]="s.reason">{{ adviceLabel(s) }}</span>
                            </td>
                            <td class="text-right">
                              @if (s.excluded || s.partlyExcluded) {
                                <button type="button" class="btn btn-ghost btn-xs" [disabled]="busy()" (click)="review(d, s, 'include')">Reincluir</button>
                              }
                              @if (!s.excluded && s.canExclude) {
                                <button type="button" class="btn btn-ghost btn-xs" [disabled]="busy()" (click)="review(d, s, 'exclude')">Excluir</button>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            }

            @if (error()) {
              <div role="alert" class="alert alert-error alert-soft">
                <app-icon name="warning" />
                <span class="text-sm">{{ error() }}</span>
              </div>
            }

            @if (pending(); as p) {
              <div role="alertdialog" aria-label="Confirmar mudança" class="rounded-box border border-base-300 bg-base-200/60 p-4">
                <p class="text-sm font-medium">
                  {{ p.change === 'exclude' ? 'Excluir' : 'Reincluir' }} «{{ p.label }}» em {{ p.adGroups === 1 ? '1 grupo de anúncios' : p.adGroups + ' grupos de anúncios' }}
                  da campanha {{ selectedName() }}?
                </p>
                <p class="mt-1 text-xs text-base-content/70">
                  O Google já validou a operação e nada foi gravado ainda. Ao confirmar, ela passa a valer na conta e fica registrada
                  na Auditoria, para você comparar o resultado antes e depois.
                </p>
                <div class="mt-3 flex gap-2">
                  <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="apply()">
                    @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
                    Aplicar no Google Ads
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="cancel()">Cancelar</button>
                </div>
              </div>
            }
            <p class="text-xs text-base-content/60">
              Fonte: Google Ads, período selecionado. Renda é a faixa de renda domiciliar por percentil, como o Google define.
            </p>
          }
        </div>
      </section>
    }
  `,
})
export class DisplayDemographics {
  private readonly ws = inject(Workspace);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly account = inject(AccountStore);
  private readonly api = inject(GoogleAdsApi);
  private readonly changes = inject(ChangesStore);
  private readonly toast = inject(ToastService);

  protected readonly money = brl;
  protected readonly num = (v: number, d = 0): string => num(v, d);
  protected readonly pct = (v: number, d = 0): string => pct(v, d);

  protected readonly displayCampaigns = computed(() =>
    (this.ws.campaigns.value() ?? []).filter((c) => c.channel === 'DISPLAY' && c.status !== 'REMOVED').sort((a, b) => b.cost - a.cost),
  );

  private readonly chosen = signal('');
  protected readonly campaignId = computed(() => {
    const list = this.displayCampaigns();
    return list.find((c) => c.id === this.chosen())?.id ?? list[0]?.id ?? '';
  });
  protected readonly selectedName = computed(() => this.displayCampaigns().find((c) => c.id === this.campaignId())?.name ?? '');

  protected readonly loaded = computed(() => this.ws.demographics.value() !== undefined && this.ws.displayAdGroups.value() !== undefined);
  protected readonly error = signal('');
  private readonly loadError = computed(() => this.ws.demographics.error() ?? this.ws.displayAdGroups.error());

  protected readonly report = computed(() => {
    const id = this.campaignId();
    if (!id || !this.loaded()) return null;
    return reportDemographics(this.ws.demographics.value() ?? [], id, this.cfg.config().thresholds);
  });

  protected readonly optimized = computed(
    () => (this.ws.displayAdGroups.value() ?? []).filter((g) => g.campaignId === this.campaignId() && g.optimizedTargeting).length,
  );

  protected readonly pending = signal<Pending | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    // As consultas de demografia só rodam quando a conta tem campanha de Display.
    effect(() => {
      if (this.displayCampaigns().length) {
        untracked(() => {
          this.ws.demographics.need();
          this.ws.displayAdGroups.need();
        });
      }
    });
    effect(() => {
      const e = this.loadError();
      if (e) this.error.set(e);
    });
  }

  protected pick(event: Event): void {
    this.chosen.set((event.target as HTMLSelectElement).value);
    this.pending.set(null);
  }

  protected adviceLabel(s: SegmentReport): string {
    return ADVICE_LABEL[s.advice];
  }

  protected adviceClass(s: SegmentReport): string {
    return ADVICE_CLASS[s.advice];
  }

  private payload(p: Pending, step: 'preview' | 'apply') {
    return { campaignId: this.campaignId(), dimension: p.dimension, segment: p.segment, change: p.change, step };
  }

  private message(e: unknown): string {
    return (e as { error?: { error?: string } })?.error?.error ?? 'Não foi possível falar com o servidor. Confira se o painel está rodando.';
  }

  protected async review(d: DimensionReport, s: SegmentReport, change: 'exclude' | 'include'): Promise<void> {
    const pending: Pending = { dimension: d.dimension, segment: s.segment, label: s.label, change, adGroups: 0 };
    this.busy.set(true);
    this.error.set('');
    this.pending.set(null);
    try {
      const res = await firstValueFrom(this.api.displayDemographics(this.payload(pending, 'preview'), this.account.selectedId()));
      if (res.unchanged) {
        this.toast.info('Esse perfil já está como você pediu.');
        return;
      }
      this.pending.set({ ...pending, adGroups: res.adGroups });
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    this.pending.set(null);
  }

  protected async apply(): Promise<void> {
    const p = this.pending();
    if (!p || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.displayDemographics(this.payload(p, 'apply'), this.account.selectedId()));
      const verb = p.change === 'exclude' ? 'Exclusão' : 'Reinclusão';
      await this.changes.add({
        at: new Date().toISOString().slice(0, 19),
        kind: 'CAMPAIGN',
        title: `${verb} de perfil no Display: ${p.label}`,
        description: `${verb} do perfil «${p.label}» (${p.dimension}) em ${p.adGroups} grupo(s) de anúncios da campanha ${this.selectedName()}.`,
        source: 'APP',
        campaignId: this.campaignId(),
        entity: { type: 'campaign', id: this.campaignId(), label: this.selectedName() },
        expected:
          p.change === 'exclude'
            ? 'Menos impressões e gasto neste perfil. Compare o custo por conversão antes e depois.'
            : 'Volta a entregar para este perfil. Compare o custo por conversão antes e depois.',
      } as Omit<ChangeEntry, 'id' | 'accountId'>);
      this.pending.set(null);
      this.toast.success('Alteração aplicada no Google Ads e registrada na Auditoria.');
      this.ws.demographics.reload();
    } catch (e) {
      this.pending.set(null);
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }
}
