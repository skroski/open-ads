import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AccountStore } from '../../core/account.store';
import { ChangesStore } from '../../core/collections';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { AudienceMode, DisplayAudienceState, GoogleAdsApi } from '../../data/google-ads.api';
import { ChangeEntry } from '../../domain/models';
import { Icon } from '../../shared/icon';
import { AppModal } from '../../shared/modal';
import { PageHeader } from '../../shared/page-header';

const MODES: ReadonlyArray<{ key: AudienceMode; title: string; text: string }> = [
  { key: 'EXISTING', title: 'Só usar os públicos que já estão no grupo', text: 'Não cria nada. Desliga a expansão automática, para o Google parar de mostrar anúncios fora desses públicos.' },
  { key: 'RESTRICT', title: 'Criar um público e mostrar só para ele', text: 'Cria um público personalizado com as palavras e sites abaixo, aplica aos grupos e desliga a expansão automática.' },
  { key: 'OBSERVE', title: 'Criar um público só para observar', text: 'O anúncio continua alcançando mais gente; você apenas vê como esse público se comporta.' },
];

const splitLines = (text: string): string[] => text.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);

@Component({
  selector: 'app-display-audience-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppModal, Icon, PageHeader],
  template: `
    <app-page-header
      group="Ações e aprendizado"
      title="Público do Display"
      subtitle="Escolha para quem a campanha de Display aparece. Você revisa tudo antes e nada é enviado ao Google Ads sem a sua confirmação."
    />

    <div class="flex flex-col gap-block">
      <div role="note" class="alert alert-soft text-sm">
        <app-icon name="info" />
        <span>O Google não segmenta por profissão ou cargo. O público é uma aproximação por interesse, pesquisas e sites que a pessoa visita. Quanto melhor descrever o seu público, mais perto você chega.</span>
      </div>

      <section class="card card-border bg-base-100">
        <div class="card-body gap-4 p-4 sm:p-6">
          <h2 class="text-base font-semibold">1. Campanha</h2>
          @if (displayCampaigns().length) {
            <select class="select w-full sm:w-96" aria-label="Campanha de Display" [value]="campaignId()" (change)="pick($event)">
              <option value="">Escolha uma campanha de Display</option>
              @for (c of displayCampaigns(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select>
          } @else {
            <p class="text-sm text-base-content/70">Nenhuma campanha de Display com dados no período. Ajuste o período ou a conta.</p>
          }

          @if (loading()) { <span class="loading loading-spinner"></span> }
          @if (error()) { <p role="alert" class="text-sm text-error">{{ error() }}</p> }
          @if (state(); as s) {
            <div class="flex flex-col gap-3">
              @for (g of s.adGroups; track g.id) {
                <div class="rounded-box border border-base-300 p-4 text-sm">
                  <div class="font-semibold">{{ g.name }}</div>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <span class="badge badge-soft" [class]="g.optimizedTargeting ? 'badge-warning' : 'badge-success'">Expansão automática: {{ g.optimizedTargeting ? 'LIGADA' : 'desligada' }}</span>
                    <span class="badge badge-ghost">Públicos: {{ audienceMode(g.restrictions) }}</span>
                  </div>
                  @if (g.audiences.length) { <p class="mt-2 text-base-content/70">Públicos já aplicados: {{ g.audiences.join(' · ') }}</p> }
                  @if (g.optimizedTargeting) { <p class="mt-2 text-warning">Com a expansão ligada, o Google pode mostrar os anúncios para pessoas fora dos públicos escolhidos.</p> }
                </div>
              }
            </div>
          }
        </div>
      </section>

      @if (state()) {
        <section class="card card-border bg-base-100">
          <div class="card-body gap-4 p-4 sm:p-6">
            <h2 class="text-base font-semibold">2. O que fazer</h2>
            <div class="flex flex-col gap-2">
              @for (m of modes; track m.key) {
                <label class="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3">
                  <input type="radio" class="radio radio-sm mt-1" name="mode" [checked]="mode() === m.key" (change)="mode.set(m.key)" />
                  <span><span class="block font-medium">{{ m.title }}</span><span class="block text-sm text-base-content/70">{{ m.text }}</span></span>
                </label>
              }
            </div>

            @if (mode() !== 'EXISTING') {
              <div class="grid gap-4 sm:grid-cols-2">
                <fieldset class="fieldset sm:col-span-2"><legend class="fieldset-legend">Nome do público</legend><input class="input w-full" [value]="name()" (input)="name.set(val($event))" placeholder="Ex.: Meu público ideal" /></fieldset>
                <fieldset class="fieldset"><legend class="fieldset-legend">Palavras que o seu público pesquisa (uma por linha)</legend><textarea class="textarea min-h-32 w-full" [value]="keywords()" (input)="keywords.set(val($event))" placeholder="Ex.: assuntos que o seu público pesquisa"></textarea></fieldset>
                <fieldset class="fieldset"><legend class="fieldset-legend">Sites que o seu público visita (um por linha)</legend><textarea class="textarea min-h-32 w-full" [value]="urls()" (input)="urls.set(val($event))" placeholder="Ex.: sitedoseusetor.com.br"></textarea></fieldset>
              </div>
            }

            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="review()"><app-icon name="check" size="sm" /> Revisar com o Google</button>
              <span class="text-sm text-base-content/65">A revisão só valida; nada é gravado.</span>
            </div>
          </div>
        </section>
      }
    </div>

    <app-modal [(open)]="confirmOpen" size="md">
      <h2 class="text-lg font-semibold">Confirmar alteração no Google Ads</h2>
      <p class="mt-2 text-sm">O Google validou o pedido. Ao confirmar, esta alteração <strong>vai para a conta de anúncios</strong>:</p>
      <ul class="mt-3 list-disc pl-5 text-sm">
        @for (line of summary(); track line) { <li>{{ line }}</li> }
      </ul>
      <p class="mt-3 text-sm text-base-content/70">Para desfazer: ligue de novo a expansão automática no grupo de anúncios e remova o público no Google Ads. A alteração fica registrada na Auditoria.</p>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" (click)="confirmOpen.set(false)">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="apply()">Aplicar no Google Ads</button>
      </div>
    </app-modal>
  `,
})
export class DisplayAudiencePage {
  private readonly api = inject(GoogleAdsApi);
  private readonly account = inject(AccountStore);
  private readonly changes = inject(ChangesStore);
  private readonly toast = inject(ToastService);
  protected readonly ws = inject(Workspace);

  protected readonly modes = MODES;
  protected readonly campaignId = signal('');
  protected readonly state = signal<DisplayAudienceState | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly mode = signal<AudienceMode>('EXISTING');
  protected readonly name = signal('');
  protected readonly keywords = signal('');
  protected readonly urls = signal('');
  protected readonly confirmOpen = signal(false);

  protected readonly displayCampaigns = computed(() => (this.ws.campaigns.value() ?? []).filter((c) => c.channel === 'DISPLAY'));
  protected readonly summary = computed(() => {
    const groups = this.state()?.adGroups.length ?? 0;
    const lines = [`Campanha “${this.state()?.campaignName ?? ''}”: ${groups} grupo(s) de anúncios.`];
    if (this.mode() !== 'EXISTING') lines.push(`Cria o público “${this.name().trim()}” com ${splitLines(this.keywords()).length} palavra(s) e ${splitLines(this.urls()).length} site(s).`);
    lines.push(this.mode() === 'OBSERVE' ? 'Os públicos só observam; o alcance não muda.' : 'Desliga a expansão automática e passa a mostrar só para os públicos.');
    return lines;
  });

  constructor() {
    this.ws.campaigns.need();
    effect(() => {
      this.account.selectedId();
      this.campaignId.set('');
      this.state.set(null);
    });
  }

  protected val(event: Event): string { return (event.target as HTMLInputElement | HTMLTextAreaElement).value; }

  protected audienceMode(restrictions: Array<{ targetingDimension: string; bidOnly: boolean }>): string {
    const r = restrictions.find((x) => x.targetingDimension === 'AUDIENCE');
    return !r ? 'não definido' : r.bidOnly ? 'só observação' : 'segmentação (restringe)';
  }

  protected async pick(event: Event): Promise<void> {
    const id = (event.target as HTMLSelectElement).value;
    this.campaignId.set(id);
    this.state.set(null);
    this.error.set('');
    if (!id) return;
    this.loading.set(true);
    try {
      this.state.set(await firstValueFrom(this.api.displayAudience({ action: 'inspect', campaignId: id }, this.account.selectedId())));
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.loading.set(false);
    }
  }

  private payload(action: 'preview' | 'apply') {
    return { action, campaignId: this.campaignId(), mode: this.mode(), name: this.name(), keywords: splitLines(this.keywords()), urls: splitLines(this.urls()) };
  }

  private message(e: unknown): string {
    const err = (e as { error?: { error?: string } })?.error?.error;
    return err ?? 'Não foi possível falar com o servidor. Confira se o painel está rodando.';
  }

  protected async review(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.displayAudience(this.payload('preview'), this.account.selectedId()));
      this.confirmOpen.set(true);
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.displayAudience(this.payload('apply'), this.account.selectedId()));
      const state = this.state();
      await this.changes.add({
        at: new Date().toISOString().slice(0, 19),
        kind: 'CAMPAIGN',
        title: `Público do Display: ${state?.campaignName ?? ''}`,
        description: this.summary().join(' '),
        source: 'APP',
        campaignId: this.campaignId(),
        entity: { type: 'campaign', id: this.campaignId(), label: state?.campaignName ?? '' },
        expected: 'Menos impressões e cliques fora do público escolhido. Compare custo por conversão antes e depois.',
      } as Omit<ChangeEntry, 'id' | 'accountId'>);
      this.confirmOpen.set(false);
      this.toast.success('Alteração aplicada no Google Ads e registrada na Auditoria.');
      this.state.set(await firstValueFrom(this.api.displayAudience({ action: 'inspect', campaignId: this.campaignId() }, this.account.selectedId())));
    } catch (e) {
      this.confirmOpen.set(false);
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }
}
