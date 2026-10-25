import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AccountStore } from '../../core/account.store';
import { BusinessConfigStore } from '../../core/business-config.store';
import { describeError } from '../../core/dataset';
import { Workspace } from '../../core/workspace';
import { IntegrationsApi } from '../../data/integrations.api';
import { Fact, buildThemeFacts } from '../../domain/autofill-facts';
import { CampaignTip, campaignTips } from '../../domain/campaign-potential';
import { brl, num } from '../../domain/format';
import { testBudget } from '../../domain/keyword-test-budget';
import { ConfidenceLevel } from '../../domain/models';
import { normalize } from '../../domain/text';
import { detectConversionOutages } from '../../domain/tracking';
import { Icon } from '../../shared/icon';

const CONFIDENCE: Record<ConfidenceLevel, string> = { HIGH: 'Confiança alta', MEDIUM: 'Confiança média', LOW: 'Confiança baixa' };

interface Theme {
  theme: string;
  reason: string;
  evidence: string[];
}

/**
 * Onde investir: dicas por campanha a partir da parcela de impressões do Google Ads, e temas de palavra-chave
 * propostos pela IA com o custo estimado para aprender se funcionam. Nada aqui promete resultado nem escreve
 * na conta. Sem o Planejador de Palavras-chave não há volume de busca, e o painel não o estima.
 */
@Component({
  selector: 'app-investment-tips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <section class="card card-border bg-base-100" data-open-help="palavras-investimento">
      <div class="card-body gap-4">
        <div>
          <h2 class="card-title text-base"><app-icon name="trend-up" size="sm" /> Dicas de investimento</h2>
          <p class="text-sm text-base-content/70">
            Onde mais verba pode render e quais palavras vale testar, sempre a partir dos dados da sua conta. O painel
            só projeta o que a campanha sustenta e diz o que falta quando não sustenta.
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
              <span class="loading loading-spinner loading-sm"></span> Lendo campanhas e parcela de impressões…
            </p>
          }
        } @else {
          <div>
            <h3 class="text-sm font-semibold">Campanhas</h3>
            @if (!tips().length) {
              <p class="mt-1 text-sm text-base-content/70">
                Nenhuma campanha de Pesquisa ativa perde impressões de forma relevante neste período, ou o Google não
                informou a parcela de impressões.
              </p>
            }
            <ul class="mt-2 flex flex-col gap-3">
              @for (t of tips(); track t.campaignId + t.kind) {
                <li class="rounded-box border border-base-300 p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <strong class="text-sm">{{ t.campaignName }}</strong>
                    <span [class]="badge(t)">{{ kindLabel(t) }}</span>
                    @if (t.confidence) {
                      <span class="badge badge-ghost badge-sm" [title]="t.confidence.reasons.join(' ')">{{ confidence(t.confidence.level) }}</span>
                    }
                  </div>
                  <p class="mt-1 text-sm">{{ t.headline }}</p>
                  @if (t.status === 'ready' && t.extraConversions; as c) {
                    <p class="mt-1 text-sm">
                      Mais verba pode trazer de <strong>{{ num(c.low, 1) }}</strong> a <strong>{{ num(c.high, 1) }}</strong>
                      conversões no período, com cerca de {{ num(t.extraClicks ?? 0) }} cliques a mais e
                      {{ money(t.extraCost ?? 0) }} a mais de gasto (≈ {{ money(t.extraCostPerDay ?? 0) }} por dia).
                    </p>
                  }
                  <ul class="mt-1 text-xs text-base-content/70">
                    @for (e of t.evidence; track $index) {
                      <li>{{ e }}</li>
                    }
                  </ul>
                  @for (c of t.caveats; track $index) {
                    <p class="mt-1 text-xs" [class.text-warning]="t.status !== 'ready' && t.status !== 'info'">{{ c }}</p>
                  }
                  @if (t.provenance) {
                    <p class="mt-1 text-xs text-base-content/60">Origem: {{ t.provenance.detail }}.</p>
                  }
                </li>
              }
            </ul>
          </div>

          <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-semibold">Palavras para testar (IA)</h3>
                <p class="text-xs text-base-content/70">
                  A IA propõe temas a partir do seu contexto e dos termos que já converteram. São hipóteses: sem volume
                  de busca nem resultado prometido.
                </p>
              </div>
              <button type="button" class="btn btn-sm" [disabled]="!hasContext() || busy()" (click)="ask()">
                @if (busy()) { <span class="loading loading-spinner loading-xs"></span> } @else { <app-icon name="sparkles" size="sm" /> }
                Sugerir temas
              </button>
            </div>
            @if (!hasContext()) {
              <p class="mt-2 text-xs text-warning">
                Preencha ao menos "O que você vende" em <a routerLink="/configuracoes" class="link">Configurações</a>.
              </p>
            }
            @if (note()) {
              <p class="mt-2 text-xs text-base-content/70">{{ note() }}</p>
            }

            @if (themes().length) {
              <div class="mt-3 text-xs">
                @if (budget(); as b) {
                  @if (b.status === 'ready') {
                    <p>
                      <strong>Para aprender se um tema funciona</strong> (cerca de {{ b.targetConversions }} conversões):
                      {{ num(b.clicks.low) }} a {{ num(b.clicks.high) }} cliques, ou {{ money(b.cost.low) }} a {{ money(b.cost.high) }}.
                      Usa a sua taxa de conversão em Pesquisa ({{ num(b.conversionRate.low * 100, 0) }}% a {{ num(b.conversionRate.high * 100, 0) }}%)
                      e o seu CPC ({{ money(b.cpc.low) }} a {{ money(b.cpc.high) }}). {{ confidence(b.confidence.level) }}.
                    </p>
                    @for (c of b.caveats; track $index) {
                      <p class="text-base-content/60">{{ c }}</p>
                    }
                  } @else {
                    <p class="text-warning">Ainda não dá para estimar o custo de um teste: {{ b.reason }}</p>
                  }
                }
              </div>
              <ul class="mt-2 flex flex-col gap-2">
                @for (t of themes(); track t.theme) {
                  <li class="rounded-box bg-base-100 p-2 text-sm">
                    <strong>{{ t.theme }}</strong>
                    <p class="text-xs">{{ t.reason }}</p>
                    <p class="text-xs text-base-content/60">Baseado em: {{ evidenceText(t.evidence) }}</p>
                  </li>
                }
              </ul>
            }
          </div>

          <p class="text-xs text-base-content/60">
            <app-icon name="info" size="xs" /> Volume de busca vem do Planejador de Palavras-chave do Google. Com acesso
            à API no nível Explorer ele não é liberado: o painel não estima volume. Para liberar, peça acesso Basic no
            Google Ads API Center do seu projeto.
          </p>
        }
      </div>
    </section>
  `,
})
export class InvestmentTips {
  private readonly ws = inject(Workspace);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly account = inject(AccountStore);
  private readonly api = inject(IntegrationsApi);

  protected readonly money = brl;
  protected readonly num = (v: number, d = 0): string => num(v, d);

  private readonly datasets = [this.ws.impressionShare, this.ws.daily, this.ws.searchTermsRaw, this.ws.ads, this.ws.keywordsBase, this.ws.keywordMetrics];
  protected readonly error = computed(() => this.datasets.map((d) => d.error()).find((e) => e) ?? null);
  protected readonly ready = computed(() => this.datasets.every((d) => d.value() !== undefined));

  private readonly windowDays = computed(() => this.account.window().days);
  private readonly trackingBroken = computed(() =>
    detectConversionOutages(this.ws.daily.value() ?? []).some((f) => f.scope === 'ACCOUNT' && f.ongoing),
  );

  protected readonly tips = computed<CampaignTip[]>(() => {
    if (!this.ready()) return [];
    const rows = this.ws.impressionShare.value() ?? [];
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    const conv = rows.reduce((s, r) => s + r.conversions, 0);
    const c = this.cfg.config();
    return campaignTips({
      rows,
      windowDays: this.windowDays(),
      costTarget: c.goal.targetCostPerGoal,
      aboveTargetFactor: c.thresholds.aboveTargetFactor,
      accountCostPerConversion: conv > 0 ? cost / conv : null,
      trackingBroken: this.trackingBroken(),
    });
  });

  protected readonly budget = computed(() =>
    this.ready()
      ? testBudget({ rows: this.ws.impressionShare.value() ?? [], windowDays: this.windowDays(), trackingBroken: this.trackingBroken() })
      : null,
  );

  protected readonly hasContext = computed(() => this.cfg.config().context.offer.trim().length > 0);

  // ── Temas da IA (opcional: só com ANTHROPIC_API_KEY no servidor)
  protected readonly busy = signal(false);
  protected readonly note = signal('');
  private readonly raw = signal<Theme[]>([]);
  private readonly facts = signal<Fact[]>([]);

  /** Temas que já existem como palavra-chave da conta ficam de fora. */
  protected readonly themes = computed(() => {
    const have = new Set(this.ws.keywords().map((k) => normalize(k.text.replace(/[[\]"+]/g, ''))));
    return this.raw().filter((t) => !have.has(normalize(t.theme)));
  });

  constructor() {
    for (const d of this.datasets) d.need();
  }

  protected kindLabel(t: CampaignTip): string {
    if (t.kind === 'RANK') return 'Ranking';
    return t.status === 'ready' ? 'Orçamento' : t.status === 'blocked' ? 'Orçamento: bloqueado' : 'Orçamento: aguardando dados';
  }

  // Classes escritas por inteiro: o Tailwind só gera o que encontra no código.
  protected badge(t: CampaignTip): string {
    if (t.status === 'ready') return 'badge badge-success badge-soft badge-sm';
    if (t.status === 'info') return 'badge badge-info badge-soft badge-sm';
    if (t.status === 'blocked') return 'badge badge-error badge-soft badge-sm';
    return 'badge badge-warning badge-soft badge-sm';
  }

  protected confidence(level: ConfidenceLevel): string {
    return CONFIDENCE[level];
  }

  protected evidenceText(ids: readonly string[]): string {
    const byId = new Map(this.facts().map((f) => [f.id, f.text]));
    return ids.map((id) => byId.get(id) ?? id).join('; ');
  }

  protected async ask(): Promise<void> {
    if (!this.hasContext() || this.busy() || !this.ready()) return;
    const facts = buildThemeFacts(this.cfg.config().context, {
      campaigns: this.ws.campaigns.value() ?? [],
      ads: this.ws.ads.value() ?? [],
      terms: this.ws.searchTermsRaw.value() ?? [],
    });
    this.busy.set(true);
    this.note.set('');
    try {
      const res = await firstValueFrom(this.api.autofill({ facts, themes: true }));
      if (!res.configured) {
        this.note.set(res.reason ?? 'A IA não está configurada neste servidor. Rode "npm run setup" e informe a chave.');
        return;
      }
      this.facts.set(facts);
      this.raw.set(res.themes ?? []);
      const dropped = res.dropped ? ` ${res.dropped} ${res.dropped === 1 ? 'sugestão foi descartada' : 'sugestões foram descartadas'} por não ter base nos seus dados.` : '';
      this.note.set(res.reason ?? ((res.themes?.length ?? 0) === 0 ? `A IA não encontrou temas com base suficiente.${dropped}` : `Temas prontos para revisão.${dropped}`));
    } catch (e) {
      this.note.set(describeError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
