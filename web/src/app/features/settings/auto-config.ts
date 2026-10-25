import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormField, FormRoot, form } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { AccountStore } from '../../core/account.store';
import { BusinessConfigStore } from '../../core/business-config.store';
import { describeError } from '../../core/dataset';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { AutofillResponse, IntegrationsApi } from '../../data/integrations.api';
import { Fact, buildFactSheet } from '../../domain/autofill-facts';
import { Suggestion, SuggestionStatus, applySuggestions, suggestParameters } from '../../domain/config-suggest';
import { BusinessContext, ConfidenceLevel, STAGE_LABEL } from '../../domain/models';
import { SOURCE_LABEL } from '../../domain/provenance';
import { detectConversionOutages } from '../../domain/tracking';
import { Icon } from '../../shared/icon';

const STATUS_LABEL: Record<SuggestionStatus, string> = {
  ready: 'Sugerido',
  insufficient: 'Aguardando dados',
  needs_user: 'Precisa de você',
  locked: 'Já definido',
  blocked: 'Bloqueado',
};

// Classes escritas por inteiro: o Tailwind só gera o que encontra no código.
const STATUS_CLASS: Record<SuggestionStatus, string> = {
  ready: 'badge badge-info badge-soft badge-sm',
  insufficient: 'badge badge-warning badge-soft badge-sm',
  needs_user: 'badge badge-neutral badge-soft badge-sm',
  locked: 'badge badge-success badge-soft badge-sm',
  blocked: 'badge badge-error badge-soft badge-sm',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'Confiança alta',
  MEDIUM: 'Confiança média',
  LOW: 'Confiança baixa',
};

const CONTEXT_FIELDS: ReadonlyArray<{ key: keyof BusinessContext; label: string; hint: string }> = [
  { key: 'offer', label: 'O que você vende', hint: 'Ex.: implantes e clareamento dentário para adultos.' },
  { key: 'notOffer', label: 'O que você NÃO vende ou não atende', hint: 'Ex.: não faz ortodontia infantil nem atende convênios.' },
  { key: 'idealCustomer', label: 'Cliente ideal', hint: 'Quem você quer atender.' },
  { key: 'notCustomer', label: 'Quem não é cliente', hint: 'Ex.: quem procura vaga de emprego, curso ou preço de atacado.' },
];

@Component({
  selector: 'app-auto-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Faz as duas seções participarem do espaçamento da página de Configurações.
  host: { class: 'contents' },
  imports: [FormField, FormRoot, Icon],
  template: `
    <section class="card card-border bg-base-100" data-open-help="configuracoes-auto">
      <div class="card-body gap-4">
        <div>
          <h2 class="card-title text-base"><app-icon name="sparkles" size="sm" /> Configurar com meus dados</h2>
          <p class="text-sm text-base-content/70">
            O painel lê a sua conta e propõe cada parâmetro, mostrando de onde veio. Nada é gravado até você aceitar, e o
            que você já definiu nunca é sobrescrito. Margem, custo por cliente e ROI não existem no Google Ads: o painel
            não estima esses valores.
          </p>
        </div>

        @if (!started()) {
          <div><button type="button" class="btn btn-primary btn-sm" (click)="start()">Analisar minha conta</button></div>
        } @else if (loadError()) {
          <div role="alert" class="alert alert-error alert-soft">
            <app-icon name="warning" />
            <span class="text-sm">Não foi possível ler a conta: {{ loadError() }}</span>
          </div>
        } @else if (!dataReady()) {
          <p class="flex items-center gap-2 text-sm text-base-content/70">
            <span class="loading loading-spinner loading-sm"></span> Lendo campanhas, conversões, regiões e horários…
          </p>
        } @else {
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-base-content/70">
              Base: {{ windowDays() }} dias (período selecionado no topo). {{ readyCount() }} de {{ suggestions().length }}
              parâmetros têm proposta pronta.
            </p>
            <button type="button" class="btn btn-primary btn-sm" [disabled]="!readyCount()" (click)="acceptAll()">
              <app-icon name="check" size="sm" /> Aceitar tudo que está claro ({{ readyCount() }})
            </button>
          </div>

          <ul class="flex flex-col gap-3">
            @for (s of suggestions(); track s.key) {
              <li class="rounded-box border border-base-300 p-3">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="text-sm font-semibold">{{ s.title }}</h3>
                      <span [class]="statusClass(s.status)">{{ statusLabel(s) }}</span>
                      @if (s.confidence) {
                        <span class="badge badge-ghost badge-sm" [title]="s.confidence.reasons.join(' ')">
                          {{ confidenceLabel(s.confidence.level) }}
                        </span>
                      }
                    </div>
                    @if (s.summary) {
                      <p class="mt-1 text-sm font-medium">{{ s.summary }}</p>
                    }
                    <p class="mt-1 text-xs text-base-content/70">{{ s.reason }}</p>
                    @if (s.question) {
                      <p class="mt-1 text-xs"><strong>Para você decidir:</strong> {{ s.question }}</p>
                    }
                    @if (s.provenance) {
                      <p class="mt-1 text-xs text-base-content/60">
                        Origem: {{ sourceLabel(s.provenance.source) }} — {{ s.provenance.detail }}
                      </p>
                    }
                    @for (d of s.doubts ?? []; track $index) {
                      <p class="mt-1 text-xs text-warning">{{ d }}</p>
                    }
                  </div>
                  @if (s.status === 'ready') {
                    <button type="button" class="btn btn-sm" (click)="accept(s)">Aceitar</button>
                  }
                </div>
              </li>
            }
          </ul>

          @if (ambiguous().length) {
            <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
              <h3 class="text-sm font-semibold">Conversões com nome ambíguo</h3>
              <p class="mt-1 text-xs text-base-content/70">
                O nome não indica a etapa do funil: {{ ambiguous().join(', ') }}. A IA pode propor uma etapa, com o
                motivo, só com base nos dados da sua conta. Você decide.
              </p>
              <div class="mt-2">
                <button type="button" class="btn btn-sm" [disabled]="aiBusy()" (click)="askAi(false)">
                  @if (aiBusy()) { <span class="loading loading-spinner loading-xs"></span> }
                  Pedir ajuda da IA
                </button>
              </div>
            </div>
          }
          @if (pendingStages().length) {
            <ul class="flex flex-col gap-2">
              @for (st of pendingStages(); track st.name) {
                <li class="flex flex-wrap items-start justify-between gap-2 rounded-box border border-base-300 p-3">
                  <div class="min-w-0 text-sm">
                    <strong>{{ st.name }}</strong> → {{ stageLabel(st.stage) }}
                    <p class="text-xs text-base-content/70">{{ st.reason }}</p>
                    <p class="text-xs text-base-content/60">Baseado em: {{ evidenceText(st.evidence) }}</p>
                  </div>
                  <button type="button" class="btn btn-sm" (click)="acceptStage(st.name, st.stage)">Aceitar</button>
                </li>
              }
            </ul>
          }
        }
      </div>
    </section>

    <section class="card card-border bg-base-100" data-open-help="configuracoes-contexto">
      <div class="card-body gap-4">
        <div>
          <h2 class="card-title text-base"><app-icon name="target" size="sm" /> Contexto do negócio</h2>
          <p class="text-sm text-base-content/70">
            O Google decide onde seu anúncio aparece sem saber o que você realmente vende. Este contexto é a base para
            apontar impressões e gasto fora do alvo. Campo vazio não influencia nada.
          </p>
        </div>
        <form [formRoot]="contextForm" class="grid gap-4 md:grid-cols-2">
          @for (f of contextFields; track f.key) {
            <fieldset class="fieldset">
              <legend class="fieldset-legend">{{ f.label }}</legend>
              <textarea class="textarea h-24 w-full text-sm" [placeholder]="f.hint" [formField]="contextForm[f.key]"></textarea>
              @if (aiContext(f.key); as hint) {
                <div class="mt-1 rounded-box bg-base-200/60 p-2 text-xs">
                  <p><strong>Sugestão da IA:</strong> {{ hint.text }}</p>
                  <p class="text-base-content/60">Baseado em: {{ evidenceText(hint.evidence) }}</p>
                  <button type="button" class="btn btn-xs mt-1" (click)="useContext(f.key, hint.text)">Usar este texto</button>
                </div>
              }
            </fieldset>
          }
          <div class="flex flex-wrap items-center gap-2 md:col-span-2">
            <button type="submit" class="btn btn-sm">Salvar contexto</button>
            <button type="button" class="btn btn-ghost btn-sm" [disabled]="!dataReady() || aiBusy()" (click)="askAi(true)">
              @if (aiBusy()) { <span class="loading loading-spinner loading-xs"></span> } @else { <app-icon name="sparkles" size="sm" /> }
              Sugerir com IA a partir da minha conta
            </button>
            @if (!started()) {
              <span class="text-xs text-base-content/60">Antes, clique em "Analisar minha conta" acima.</span>
            }
          </div>
          @if (aiNote()) {
            <p class="text-xs text-base-content/70 md:col-span-2">{{ aiNote() }}</p>
          }
        </form>
      </div>
    </section>
  `,
})
export class AutoConfigPanel {
  private readonly ws = inject(Workspace);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly account = inject(AccountStore);
  private readonly api = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);

  protected readonly contextFields = CONTEXT_FIELDS;
  protected readonly started = signal(false);

  private readonly datasets = [
    this.ws.campaigns,
    this.ws.daily,
    this.ws.conversionActions,
    this.ws.conversionBreakdown,
    this.ws.regions,
    this.ws.campaignLocations,
    this.ws.hours,
    this.ws.ads,
    this.ws.searchTermsRaw,
  ];

  protected readonly loadError = computed(() => {
    if (!this.started()) return null;
    for (const d of this.datasets) {
      const e = d.error();
      if (e) return e;
    }
    return null;
  });

  protected readonly dataReady = computed(() => this.started() && this.datasets.every((d) => d.value() !== undefined));

  protected readonly windowDays = computed(() => this.account.window().days);

  protected readonly suggestions = computed<Suggestion[]>(() => {
    if (!this.dataReady()) return [];
    const campaigns = this.ws.campaigns.value() ?? [];
    const totals = campaigns.reduce(
      (t, c) => ({
        impressions: t.impressions + c.impressions,
        clicks: t.clicks + c.clicks,
        cost: t.cost + c.cost,
        conversions: t.conversions + c.conversions,
      }),
      { impressions: 0, clicks: 0, cost: 0, conversions: 0 },
    );
    const trackingBroken = detectConversionOutages(this.ws.daily.value() ?? []).some(
      (f) => f.scope === 'ACCOUNT' && f.ongoing,
    );
    return suggestParameters({
      config: this.cfg.config(),
      windowDays: this.windowDays(),
      totals,
      conversionActions: this.ws.conversionActions.value() ?? [],
      conversionBreakdown: this.ws.conversionBreakdown.value() ?? [],
      regions: this.ws.regions.value() ?? [],
      campaignLocations: this.ws.campaignLocations.value() ?? [],
      hours: this.ws.hours.value() ?? [],
      ads: this.ws.ads.value() ?? [],
      trackingBroken,
    });
  });

  protected readonly readyCount = computed(() => this.suggestions().filter((s) => s.status === 'ready').length);

  protected readonly ambiguous = computed(() => this.suggestions().find((s) => s.key === 'mapping')?.ambiguous ?? []);

  // ── Ações
  protected start(): void {
    this.started.set(true);
    for (const d of this.datasets) d.need();
  }

  protected accept(s: Suggestion): void {
    this.cfg.replaceConfig(applySuggestions(this.cfg.config(), [s]));
    this.toast.success(`${s.title}: aceito.`);
  }

  protected acceptAll(): void {
    const ready = this.suggestions().filter((s) => s.status === 'ready');
    this.cfg.replaceConfig(applySuggestions(this.cfg.config(), ready));
    this.toast.success(`${ready.length} parâmetros aceitos.`);
  }

  protected statusLabel(s: Suggestion): string {
    if (s.status === 'locked' && s.lockedState) return s.lockedState === 'CONFIRMED' ? 'Confirmado por você' : 'Informado por você';
    return STATUS_LABEL[s.status];
  }

  protected statusClass(status: SuggestionStatus): string {
    return STATUS_CLASS[status];
  }

  protected confidenceLabel(level: ConfidenceLevel): string {
    return CONFIDENCE_LABEL[level];
  }

  protected sourceLabel(source: keyof typeof SOURCE_LABEL): string {
    return SOURCE_LABEL[source];
  }

  protected stageLabel(stage: keyof typeof STAGE_LABEL): string {
    return STAGE_LABEL[stage];
  }

  // ── Contexto do negócio
  private readonly contextValue = linkedSignal(() => ({ ...this.cfg.config().context }));
  protected readonly contextForm = form(this.contextValue, {
    submission: {
      action: async () => {
        this.cfg.saveContext(this.contextValue());
        this.toast.success('Contexto salvo.');
        return undefined;
      },
    },
  });

  protected useContext(field: keyof BusinessContext, text: string): void {
    this.contextValue.update((v) => ({ ...v, [field]: text }));
  }

  // ── Ajuda da IA (opcional: só com ANTHROPIC_API_KEY no servidor)
  protected readonly aiBusy = signal(false);
  private readonly aiResult = signal<AutofillResponse | null>(null);
  private readonly aiFacts = signal<Fact[]>([]);
  protected readonly aiNote = signal('');

  protected aiContext(field: keyof BusinessContext): { text: string; evidence: string[] } | null {
    const hint = this.aiResult()?.context?.[field];
    if (!hint || this.contextValue()[field].trim() === hint.text) return null;
    return hint;
  }

  protected readonly pendingStages = computed(() => {
    const mapped = this.cfg.config().mapping;
    return (this.aiResult()?.stages ?? []).filter((s) => !(s.name in mapped));
  });

  protected evidenceText(ids: readonly string[]): string {
    const byId = new Map(this.aiFacts().map((f) => [f.id, f.text]));
    return ids.map((id) => byId.get(id) ?? id).join('; ');
  }

  protected acceptStage(name: string, stage: keyof typeof STAGE_LABEL): void {
    this.cfg.confirmMapping(name, stage);
    this.toast.success(`${name}: etapa definida.`);
  }

  protected async askAi(context: boolean): Promise<void> {
    if (!this.dataReady() || this.aiBusy()) return;
    const ambiguousNames = this.ambiguous();
    const actions = (this.ws.conversionActions.value() ?? []).filter((a) => ambiguousNames.includes(a.name));
    const facts = buildFactSheet({
      campaigns: this.ws.campaigns.value() ?? [],
      ads: this.ws.ads.value() ?? [],
      terms: this.ws.searchTermsRaw.value() ?? [],
      ambiguousActions: actions,
      conversionBreakdown: this.ws.conversionBreakdown.value() ?? [],
    });
    if (!facts.length) {
      this.aiNote.set('A conta ainda não tem dados suficientes para a IA usar.');
      return;
    }
    this.aiBusy.set(true);
    this.aiNote.set('');
    try {
      const res = await firstValueFrom(this.api.autofill({ facts, context, ambiguous: context ? [] : ambiguousNames }));
      this.aiFacts.set(facts);
      if (!res.configured) {
        this.aiNote.set(res.reason ?? 'A IA não está configurada neste servidor. Rode "npm run setup" e informe a chave.');
        return;
      }
      this.aiResult.update((prev) => ({
        ...res,
        context: { ...prev?.context, ...res.context },
        stages: res.stages?.length ? res.stages : prev?.stages,
      }));
      const dropped = res.dropped ? ` ${res.dropped} sugestão(ões) foram descartadas por não terem base nos seus dados.` : '';
      this.aiNote.set((res.reason ?? 'Sugestões da IA prontas para revisão.') + dropped);
    } catch (e) {
      this.aiNote.set(describeError(e));
    } finally {
      this.aiBusy.set(false);
    }
  }
}
