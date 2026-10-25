import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, max, min, required } from '@angular/forms/signals';
import { ActivatedRoute } from '@angular/router';
import { ChangesStore, HypothesesStore, LearningsStore } from '../../core/collections';
import { AccountStore } from '../../core/account.store';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import {
  ChangeEntry,
  ChangeKind,
  Hypothesis,
  HypothesisKind,
  HypothesisMethod,
  HypothesisStatus,
  LearningVerdict,
} from '../../domain/models';
import { today } from '../../domain/dates';
import { EChart } from '../../shared/echart';
import { Icon } from '../../shared/icon';
import { AppModal } from '../../shared/modal';
import { ExportData, PageHeader } from '../../shared/page-header';
import type { EChartsCoreOption } from 'echarts/core';

const KIND: Record<HypothesisKind, string> = {
  LANDING_URL: 'Página de destino',
  CONTENT: 'Conteúdo',
  COPY: 'Mensagem / criativo',
  BID: 'Lance / orçamento',
  OTHER: 'Outra hipótese',
};

const STATUS: Record<HypothesisStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Rascunho', cls: 'badge-ghost' },
  RUNNING: { label: 'Em avaliação', cls: 'badge-info' },
  CONCLUDED: { label: 'Concluído', cls: 'badge-success' },
  ABORTED: { label: 'Interrompido', cls: 'badge-warning' },
};

const METHOD: Record<HypothesisMethod, string> = {
  BEFORE_AFTER: 'Antes e depois',
  EXPERIMENT: 'Experimento controlado',
};

const changeKindOf = (kind: HypothesisKind): ChangeKind =>
  kind === 'LANDING_URL' ? 'URL' : kind === 'CONTENT' ? 'CONTENT' : kind === 'COPY' ? 'AD' : kind === 'BID' ? 'BID' : 'OTHER';

@Component({
  selector: 'app-experiments-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, AppModal, EChart, FormField, FormRoot, Icon, PageHeader],
  template: `
    <app-page-header
      group="Inteligência"
      title="Laboratório de experimentos"
      subtitle="Transforme uma ideia em hipótese, defina como ela será validada e registre o resultado. O laboratório não muda nada na sua conta de anúncios."
      [exportData]="exportData()"
    >
      <button type="button" class="btn btn-primary btn-sm" (click)="openCreate()"><app-icon name="plus" size="sm" /> Nova hipótese</button>
    </app-page-header>

    <div class="flex flex-col gap-block">
      <section class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <div class="grid gap-4 text-sm md:grid-cols-3">
            <div><div class="font-semibold">1. Desenhe</div><p class="mt-1 text-base-content/70">Declare o que será alterado, o resultado esperado e por quê.</p></div>
            <div><div class="font-semibold">2. Execute fora daqui</div><p class="mt-1 text-base-content/70">Revise e faça a alteração no Google Ads, site ou processo. Depois marque que entrou no ar.</p></div>
            <div><div class="font-semibold">3. Aprenda</div><p class="mt-1 text-base-content/70">Conclua com evidência. Uma queda ou resultado inconclusivo também é aprendizado.</p></div>
          </div>
          <div role="note" class="alert alert-soft text-sm">
            <app-icon name="info" />
            <span>Um experimento controlado só é válido se a divisão e as conversões forem configuradas na plataforma. “Antes e depois” pode sofrer efeito de sazonalidade, orçamento e outras mudanças.</span>
          </div>
        </div>
      </section>

      <div class="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal">
        @for (item of statusItems; track item.key) {
          <div class="stat"><div class="stat-title">{{ item.label }}</div><div class="stat-value text-2xl">{{ count(item.key) }}</div></div>
        }
      </div>

      @if (experimentChart(); as chart) {
        <section class="card card-border bg-base-100">
          <div class="card-body gap-3 p-4 sm:p-6">
            <div><h2 class="text-base font-semibold">Ciclo de aprendizado</h2><p class="text-sm text-base-content/70">Mostra o estágio de cada hipótese registrada. Não mede eficácia: a confirmação depende da conclusão com evidência.</p></div>
            <app-echart [option]="chart" [height]="250" label="Hipóteses por estágio do ciclo de aprendizado" />
          </div>
        </section>
      }

      <section class="card card-border bg-base-100">
        <div class="card-body gap-4 p-4 sm:p-6">
          <div class="flex flex-wrap gap-2">
            @for (item of statusItems; track item.key) {
              <button type="button" class="btn btn-sm" [class.btn-neutral]="filter() === item.key" (click)="filter.set(item.key)">{{ item.label }} ({{ count(item.key) }})</button>
            }
          </div>

          <ul class="flex flex-col gap-3">
            @for (h of visible(); track h.id) {
              <li class="rounded-box border border-base-300 p-4 sm:p-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap gap-2"><span class="badge badge-soft">{{ kindLabel(h.kind) }}</span><span class="badge badge-soft" [class]="statusClass(h.status)">{{ statusLabel(h.status) }}</span><span class="badge badge-ghost">{{ methodLabel(h.method) }}</span></div>
                    <h2 class="mt-3 text-base font-semibold">{{ h.title }}</h2>
                    <p class="mt-1 max-w-3xl text-sm text-base-content/75">{{ h.statement }}</p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    @if (h.status === 'DRAFT') {
                      <button type="button" class="btn btn-sm" (click)="start(h)"><app-icon name="play" size="sm" /> Já está no ar</button>
                    } @else if (h.status === 'RUNNING') {
                      <button type="button" class="btn btn-sm" (click)="openConclusion(h)"><app-icon name="check" size="sm" /> Concluir</button>
                      <button type="button" class="btn btn-ghost btn-sm" (click)="abort(h)">Interromper</button>
                    }
                    @if (h.status !== 'RUNNING') {
                      <button type="button" class="btn btn-ghost btn-sm text-error" (click)="remove(h.id)"><app-icon name="trash" size="sm" /> Remover</button>
                    }
                  </div>
                </div>
                <div class="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div><div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Melhora mínima</div><p>{{ h.minLiftPct | number: '1.0-0' }}%</p></div>
                  <div><div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Campanha</div><p>{{ campaignName(h.campaignId) }}</p></div>
                  <div><div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Início</div><p>{{ h.startedAt ?? 'Ainda não registrado' }}</p></div>
                </div>
                @if (h.conclusion) { <p class="mt-4 rounded-box bg-base-200 p-3 text-sm"><strong>Conclusão:</strong> {{ h.conclusion }}</p> }
              </li>
            } @empty {
              <li class="rounded-box border border-dashed border-base-300 p-8 text-center text-sm text-base-content/65">Nenhuma hipótese nesta situação. Comece por uma oportunidade de baixa confiança ou por uma ideia que quer validar.</li>
            }
          </ul>
        </div>
      </section>
    </div>

    <app-modal [(open)]="createOpen" size="lg">
      <h2 class="text-lg font-semibold">Nova hipótese</h2>
      <p class="mt-1 text-sm text-base-content/70">Escreva algo que possa ser refutado; “vamos melhorar” não define como avaliar.</p>
      <form [formRoot]="experimentForm" class="mt-4 grid gap-4 sm:grid-cols-2">
        <fieldset class="fieldset sm:col-span-2"><legend class="fieldset-legend">Título</legend><input class="input w-full" [formField]="experimentForm.title" placeholder="Ex.: Testar nova página de destino do produto principal" />@if (experimentForm.title().touched() && experimentForm.title().errors().length) { <p class="label text-error">{{ experimentForm.title().errors()[0].message }}</p> }</fieldset>
        <fieldset class="fieldset sm:col-span-2"><legend class="fieldset-legend">Hipótese</legend><textarea class="textarea min-h-28 w-full" [formField]="experimentForm.statement" placeholder="Se fizermos X, então Y melhora, porque Z."></textarea>@if (experimentForm.statement().touched() && experimentForm.statement().errors().length) { <p class="label text-error">{{ experimentForm.statement().errors()[0].message }}</p> }</fieldset>
        <fieldset class="fieldset"><legend class="fieldset-legend">Tipo de mudança</legend><select class="select w-full" [formField]="experimentForm.kind">@for (item of kindItems; track item.key) { <option [value]="item.key">{{ item.label }}</option> }</select></fieldset>
        <fieldset class="fieldset"><legend class="fieldset-legend">Método</legend><select class="select w-full" [formField]="experimentForm.method"><option value="BEFORE_AFTER">Antes e depois</option><option value="EXPERIMENT">Experimento controlado</option></select></fieldset>
        <fieldset class="fieldset"><legend class="fieldset-legend">Campanha (opcional)</legend><select class="select w-full" [formField]="experimentForm.campaignId"><option value="">Toda a conta</option>@for (c of campaigns(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></fieldset>
        <fieldset class="fieldset"><legend class="fieldset-legend">Melhora mínima (%)</legend><input type="number" class="input w-full" [formField]="experimentForm.minLiftPct" /></fieldset>
        <div class="modal-action sm:col-span-2"><button type="button" class="btn btn-ghost" (click)="createOpen.set(false)">Cancelar</button><button type="submit" class="btn btn-primary">Salvar hipótese</button></div>
      </form>
    </app-modal>

    <app-modal [(open)]="concludeOpen" size="md">
      @if (concluding(); as h) {
        <h2 class="text-lg font-semibold">Concluir experimento</h2><p class="mt-1 text-sm text-base-content/70">{{ h.title }}</p>
        <fieldset class="fieldset mt-4"><legend class="fieldset-legend">Resultado</legend><select class="select w-full" [value]="verdict()" (change)="verdict.set(selectValue($event))"><option value="CONFIRMED">Confirmada</option><option value="REFUTED">Refutada</option><option value="INCONCLUSIVE">Inconclusiva</option></select></fieldset>
        <fieldset class="fieldset mt-3"><legend class="fieldset-legend">Evidência ou observação</legend><textarea class="textarea min-h-24 w-full" [value]="conclusion()" (input)="conclusion.set(inputValue($event))" placeholder="O que aconteceu, em que período e qual dado sustenta a conclusão?"></textarea></fieldset>
        <div class="modal-action"><button type="button" class="btn btn-ghost" (click)="concludeOpen.set(false)">Cancelar</button><button type="button" class="btn btn-primary" (click)="conclude(h)">Registrar aprendizado</button></div>
      }
    </app-modal>
  `,
})
export class ExperimentsPage {
  protected readonly ws = inject(Workspace);
  private readonly hypotheses = inject(HypothesesStore);
  private readonly changes = inject(ChangesStore);
  private readonly learnings = inject(LearningsStore);
  private readonly account = inject(AccountStore);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  protected readonly campaigns = computed(() => this.ws.campaigns.value() ?? []);
  protected readonly kindItems = (Object.keys(KIND) as HypothesisKind[]).map((key) => ({ key, label: KIND[key] }));
  protected readonly statusItems: ReadonlyArray<{ key: 'ALL' | HypothesisStatus; label: string }> = [
    { key: 'ALL', label: 'Todas' },
    ...((Object.keys(STATUS) as HypothesisStatus[]).map((key) => ({ key, label: STATUS[key].label }))),
  ];
  protected readonly filter = signal<'ALL' | HypothesisStatus>('ALL');
  protected readonly visible = computed(() => {
    const filter = this.filter();
    return [...this.hypotheses.items()]
      .filter((h) => filter === 'ALL' || h.status === filter)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  protected readonly exportData = computed<ExportData>(() => ({
    name: 'experimentos',
    rows: this.hypotheses.items().map((h) => ({
      Hipótese: h.title,
      Tipo: KIND[h.kind],
      Método: METHOD[h.method],
      Situação: STATUS[h.status].label,
      'Melhora mínima (%)': h.minLiftPct,
      'Data de início': h.startedAt ?? '',
      Conclusão: h.conclusion ?? '',
    })),
  }));
  protected readonly experimentChart = computed<EChartsCoreOption | null>(() => {
    const values = (Object.keys(STATUS) as HypothesisStatus[]).map((status) => ({ name: STATUS[status].label, value: this.count(status) }));
    return values.some((item) => item.value > 0)
      ? {
          color: ['#9a9a9a', '#3d7ea6', '#5c9c2f', '#f1a10b'],
          tooltip: { trigger: 'item' },
          legend: { bottom: 0 },
          series: [{ type: 'pie', radius: ['42%', '68%'], avoidLabelOverlap: true, label: { formatter: '{b}: {c}' }, data: values }],
        }
      : null;
  });

  protected readonly createOpen = signal(false);
  private readonly draft = signal({ title: '', statement: '', kind: 'OTHER' as HypothesisKind, method: 'BEFORE_AFTER' as HypothesisMethod, campaignId: '', minLiftPct: 10 });
  protected readonly experimentForm = form(
    this.draft,
    (p) => {
      required(p.title, { message: 'Dê um título à hipótese.' });
      required(p.statement, { message: 'Descreva o que mudará, qual resultado espera e por quê.' });
      min(p.minLiftPct, 1, { message: 'Use ao menos 1%.' });
      max(p.minLiftPct, 500, { message: 'Use até 500%.' });
    },
    { submission: { action: async () => this.saveDraft() } },
  );

  protected readonly concludeOpen = signal(false);
  protected readonly concluding = signal<Hypothesis | null>(null);
  protected readonly verdict = signal<LearningVerdict>('INCONCLUSIVE');
  protected readonly conclusion = signal('');

  constructor() {
    this.ws.campaigns.need();
    const title = this.route.snapshot.queryParamMap.get('title');
    const statement = this.route.snapshot.queryParamMap.get('statement');
    if (title || statement) {
      this.draft.update((draft) => ({ ...draft, title: title ?? draft.title, statement: statement ?? draft.statement, kind: 'BID' }));
      this.experimentForm().reset();
      this.createOpen.set(true);
    }
  }

  protected count(status: 'ALL' | HypothesisStatus): number {
    return status === 'ALL' ? this.hypotheses.items().length : this.hypotheses.items().filter((h) => h.status === status).length;
  }

  protected kindLabel(kind: HypothesisKind): string { return KIND[kind]; }
  protected methodLabel(method: HypothesisMethod): string { return METHOD[method]; }
  protected statusLabel(status: HypothesisStatus): string { return STATUS[status].label; }
  protected statusClass(status: HypothesisStatus): string { return `badge badge-soft ${STATUS[status].cls}`; }
  protected campaignName(id: string | undefined): string { return this.campaigns().find((c) => c.id === id)?.name ?? 'Conta toda'; }
  protected inputValue(event: Event): string { return (event.target as HTMLInputElement | HTMLTextAreaElement).value; }
  protected selectValue(event: Event): LearningVerdict { return (event.target as HTMLSelectElement).value as LearningVerdict; }

  protected openCreate(): void {
    this.draft.set({ title: '', statement: '', kind: 'OTHER', method: 'BEFORE_AFTER', campaignId: '', minLiftPct: 10 });
    this.experimentForm().reset();
    this.createOpen.set(true);
  }

  private async saveDraft(): Promise<void> {
    const draft = this.draft();
    const campaign = this.campaigns().find((c) => c.id === draft.campaignId);
    await this.hypotheses.add({
      createdAt: new Date().toISOString(), kind: draft.kind, title: draft.title.trim(), statement: draft.statement.trim(),
      campaignId: draft.campaignId || undefined, method: draft.method, status: 'DRAFT', minLiftPct: draft.minLiftPct,
      baseline: campaign ? { from: this.account.window().from, to: this.account.window().to, perf: campaign } : undefined,
    } as Omit<Hypothesis, 'id' | 'accountId'>);
    this.createOpen.set(false);
    this.toast.success('Hipótese salva. Revise e execute a mudança fora do painel antes de marcar que está no ar.');
  }

  protected async start(h: Hypothesis): Promise<void> {
    const date = today();
    await this.hypotheses.upsert({ ...h, status: 'RUNNING', startedAt: date });
    await this.changes.add({
      at: `${date}T00:00:00`, kind: changeKindOf(h.kind), title: `Experimento iniciado: ${h.title}`,
      description: h.statement, source: 'MANUAL', campaignId: h.campaignId,
      entity: { type: 'hypothesis', id: h.id, label: h.title }, expected: `Melhora mínima de ${h.minLiftPct}%.`,
    } as Omit<ChangeEntry, 'id' | 'accountId'>);
    this.toast.success('Início registrado na Auditoria. Compare os resultados depois de tempo suficiente.');
  }

  protected async abort(h: Hypothesis): Promise<void> { await this.hypotheses.upsert({ ...h, status: 'ABORTED' }); }
  protected async remove(id: string): Promise<void> { await this.hypotheses.remove(id); }

  protected openConclusion(h: Hypothesis): void {
    this.concluding.set(h); this.verdict.set('INCONCLUSIVE'); this.conclusion.set(''); this.concludeOpen.set(true);
  }

  protected async conclude(h: Hypothesis): Promise<void> {
    const note = this.conclusion().trim();
    await this.hypotheses.upsert({ ...h, status: 'CONCLUDED', conclusion: note || 'Sem observações registradas.' });
    await this.learnings.add({ at: today(), title: h.title, insight: note || 'Sem observações registradas.', verdict: this.verdict(), tags: [h.kind.toLowerCase(), 'experimento'], sourceId: h.id });
    this.concludeOpen.set(false);
    this.toast.success('Aprendizado registrado para consultas futuras.');
  }
}
