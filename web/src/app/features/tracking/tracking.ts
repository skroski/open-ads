import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BusinessConfigStore } from '../../core/business-config.store';
import { PageAudits } from '../../core/page-audits';
import { TrackingHistory } from '../../core/tracking-history';
import { Workspace } from '../../core/workspace';
import {
  IntegrationsApi,
  TagManagerAccount,
  TagManagerContainer,
  TagManagerSnapshot,
  TagManagerWorkspace,
} from '../../data/integrations.api';
import { analyzeTracking } from '../../domain/tracking-health';
import type { TrackingHealthReport } from '../../domain/tracking-health';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';

/**
 * Leitor de configuração do GTM. A tela navega pela hierarquia oficial da API
 * (conta → contêiner → workspace), sem assumir nomes, IDs públicos ou modelos
 * de tag de nenhum cliente. A API expõe somente operações GET.
 */
@Component({
  selector: 'app-tracking-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PageHeader],
  template: `
    <app-page-header
      data-open-help="rastreamento-introducao"
      group="Sistema"
      title="Rastreamento"
      subtitle="Confira a configuração registrada no Google Tag Manager antes de otimizar campanhas. Esta integração apenas lê dados: ela não altera nem publica tags."
      [refresh]="false"
    >
      <button type="button" class="btn btn-sm border-base-300 bg-base-100" [disabled]="loading()" (click)="reload()">
        @if (loading()) {
          <span class="loading loading-spinner loading-xs"></span>
        } @else {
          <app-icon name="refresh" size="sm" />
        }
        Atualizar GTM
      </button>
    </app-page-header>

    <div class="flex flex-col gap-block">
      <section class="card card-border bg-base-100" data-open-help="rastreamento-fonte">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="plug" size="sm" /> Fonte selecionada</h2>
            <p class="text-sm text-base-content/70">
              Escolha o espaço de trabalho que representa a configuração que você quer auditar. A seleção fica salva
              apenas para esta conta de Google Ads neste navegador.
            </p>
          </div>

          @if (problem()) {
            <div role="alert" class="alert alert-warning alert-soft">
              <app-icon name="warning" />
              <span class="text-sm">{{ problem() }}</span>
            </div>
          }

          <div class="grid gap-4 lg:grid-cols-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Conta do Tag Manager</legend>
              <select class="select w-full" [value]="accountPath()" [disabled]="loading() || !accounts().length" (change)="chooseAccount($event)">
                <option value="">Escolha uma conta</option>
                @for (account of accounts(); track account.path) {
                  <option [value]="account.path">{{ account.name || account.id }}</option>
                }
              </select>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Contêiner</legend>
              <select class="select w-full" [value]="containerPath()" [disabled]="loading() || !containers().length" (change)="chooseContainer($event)">
                <option value="">Escolha um contêiner</option>
                @for (container of containers(); track container.path) {
                  <option [value]="container.path">{{ container.name || container.publicId || container.id }}</option>
                }
              </select>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Espaço de trabalho</legend>
              <select class="select w-full" [value]="workspacePath()" [disabled]="loading() || !workspaces().length" (change)="chooseWorkspace($event)">
                <option value="">Escolha um espaço de trabalho</option>
                @for (workspace of workspaces(); track workspace.path) {
                  <option [value]="workspace.path">{{ workspace.name || workspace.id }}</option>
                }
              </select>
            </fieldset>
          </div>

          <p class="text-xs text-base-content/60">
            Fonte: Google Tag Manager API v2 · acesso OAuth de leitura.
          </p>
        </div>
      </section>

      @if (snapshot(); as data) {
        <section class="grid gap-4 md:grid-cols-3" aria-label="Resumo do espaço de trabalho" data-open-help="rastreamento-resumo">
          <article class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-title">Tags</div>
            <div class="stat-value text-primary">{{ data.tags.length }}</div>
            <div class="stat-desc">Fonte: Google Tag Manager API</div>
          </article>
          <article class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-title">Acionadores</div>
            <div class="stat-value text-primary">{{ data.triggers.length }}</div>
            <div class="stat-desc">Fonte: Google Tag Manager API</div>
          </article>
          <article class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-title">Variáveis definidas</div>
            <div class="stat-value text-primary">{{ data.variables.length }}</div>
            <div class="stat-desc">Fonte: Google Tag Manager API</div>
          </article>
        </section>

        @if (report(); as health) {
          <section class="card card-border bg-base-100" data-open-help="rastreamento-saude">
            <div class="card-body gap-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="card-title text-base"><app-icon name="shield" size="sm" /> Saúde do rastreamento</h2>
                  <p class="max-w-3xl text-sm text-base-content/70">
                    Cruzamento entre a configuração sanitizada do GTM e a leitura das páginas usadas nos anúncios.
                    Hipóteses precisam de confirmação no Tag Assistant ou na interface do GTM.
                  </p>
                </div>
                <button type="button" class="btn btn-sm" [disabled]="audits.running().size > 0 || !landingUrls().length" (click)="auditLandingPages()">
                  @if (audits.running().size > 0) {
                    <span class="loading loading-spinner loading-xs"></span>
                  } @else {
                    <app-icon name="eye" size="sm" />
                  }
                  Auditar páginas de anúncio
                </button>
              </div>

              <div class="flex flex-wrap gap-2 text-xs">
                <span class="badge badge-ghost">{{ health.tagsWithConsent }} tag(s) com consentimento exigido</span>
                <span class="badge badge-ghost">{{ health.customEventTriggers }} acionador(es) de evento personalizado</span>
                <span class="badge badge-ghost">{{ health.pagesPendingAudit }} página(s) ainda sem leitura</span>
                <span class="badge badge-ghost">{{ health.conversionActionsWithoutTag }} ação(ões) Ads sem tag de nome parecido</span>
              </div>
              <p class="text-xs text-base-content/60">Fontes: Google Tag Manager API, Google Ads e leitura das páginas.</p>

              @if (health.findings.length) {
                <div class="flex flex-col gap-2">
                  @for (finding of health.findings; track finding.id) {
                    <div class="alert alert-soft text-sm" [class.alert-error]="finding.severity === 'CRITICAL'" [class.alert-warning]="finding.severity === 'WARNING'" [class.alert-info]="finding.severity === 'INFO'">
                      <app-icon [name]="finding.severity === 'CRITICAL' ? 'warning' : 'info'" size="sm" />
                      <div>
                        <div class="font-semibold">{{ finding.title }}</div>
                        <div>{{ finding.detail }}</div>
                        <div class="mt-1 text-xs opacity-70">{{ finding.evidenceKind === 'FACT' ? 'Fato observado' : 'Hipótese para confirmar' }} · {{ sourceLabel(finding.source) }}</div>
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <div role="status" class="alert alert-success alert-soft text-sm">
                  <app-icon name="check" size="sm" />
                  <span>Não há alerta estrutural com os dados lidos. Isso não substitui um teste real de disparo.</span>
                </div>
              }

              @if (latestChange(); as change) {
                @if (change.changed) {
                  <div class="rounded-box border border-base-300 p-3 text-sm">
                    <div class="font-semibold">Mudança desde a última leitura salva</div>
                    <div class="mt-1 text-base-content/70">
                      {{ change.addedTags.length }} adicionada(s) · {{ change.removedTags.length }} removida(s) · {{ change.changedTags.length }} alterada(s).
                      Histórico sanitizado, salvo somente neste navegador.
                    </div>
                  </div>
                }
              } @else {
                <p class="text-xs text-base-content/60">Esta primeira leitura cria a base local para comparar mudanças futuras.</p>
              }
            </div>
          </section>
        }

        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div>
              <h2 class="card-title text-base"><app-icon name="tag" size="sm" /> Tags do espaço selecionado</h2>
              <p class="text-sm text-base-content/70">
                Inventário para conferir nomes, tipo e se uma tag está pausada. Valores de parâmetros e credenciais nunca são exibidos.
              </p>
            </div>

            @if (data.tags.length) {
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead><tr><th>Tag</th><th>Tipo</th><th>Acionadores</th><th>Status</th></tr></thead>
                  <tbody>
                    @for (tag of data.tags; track tag.id) {
                      <tr>
                        <td class="font-medium">{{ tag.name || tag.id }}</td>
                        <td><code class="text-xs">{{ tag.type || 'Não informado' }}</code></td>
                        <td>{{ tag.firingTriggerIds.length }}</td>
                        <td><span class="badge badge-sm" [class.badge-warning]="tag.paused" [class.badge-success]="!tag.paused">{{ tag.paused ? 'Pausada' : 'Ativa' }}</span></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-sm text-base-content/60">Esse espaço de trabalho não tem tags configuradas.</p>
            }
            <p class="text-xs text-base-content/60">Fonte: Google Tag Manager API v2.</p>
          </div>
        </section>
      } @else if (!loading() && !problem()) {
        <section class="card card-border bg-base-100">
          <div class="card-body">
            <p class="text-sm text-base-content/60">Escolha uma conta, um contêiner e um espaço de trabalho para ver o inventário.</p>
          </div>
        </section>
      }
    </div>
  `,
})
export class TrackingPage {
  private readonly api = inject(IntegrationsApi);
  private readonly config = inject(BusinessConfigStore);
  private readonly ws = inject(Workspace);
  protected readonly audits = inject(PageAudits);
  private readonly history = inject(TrackingHistory);

  protected readonly accounts = signal<TagManagerAccount[]>([]);
  protected readonly containers = signal<TagManagerContainer[]>([]);
  protected readonly workspaces = signal<TagManagerWorkspace[]>([]);
  protected readonly snapshot = signal<TagManagerSnapshot | null>(null);
  protected readonly accountPath = signal('');
  protected readonly containerPath = signal('');
  protected readonly workspacePath = signal('');
  protected readonly loading = signal(false);
  protected readonly problem = signal('');

  protected readonly landingUrls = computed(() => Array.from(new Set((this.ws.landingPages.value() ?? []).map((page) => page.url))));
  protected readonly report = computed<TrackingHealthReport | null>(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return null;
    return analyzeTracking(
      snapshot,
      this.landingUrls().map((url) => {
        const audit = this.audits.get(url);
        return { url, readable: Boolean(audit?.ok), trackingTags: audit?.ok ? audit.trackingTags : null };
      }),
      (this.ws.conversionActions.value() ?? []).map((action) => ({ id: action.id, name: action.name, active: action.status === 'ENABLED' })),
    );
  });
  protected readonly latestChange = computed(() => {
    const workspace = this.workspacePath();
    return workspace ? this.history.latestChange(workspace) : null;
  });

  constructor() {
    this.ws.landingPages.need();
    this.ws.conversionActions.need();
    void this.loadAccounts();
  }

  protected reload(): void {
    void this.loadAccounts();
  }

  protected chooseAccount(event: Event): void {
    this.accountPath.set((event.target as HTMLSelectElement).value);
    this.containerPath.set('');
    this.workspacePath.set('');
    this.containers.set([]);
    this.workspaces.set([]);
    this.snapshot.set(null);
    void this.loadContainers();
  }

  protected chooseContainer(event: Event): void {
    this.containerPath.set((event.target as HTMLSelectElement).value);
    this.workspacePath.set('');
    this.workspaces.set([]);
    this.snapshot.set(null);
    void this.loadWorkspaces();
  }

  protected chooseWorkspace(event: Event): void {
    this.workspacePath.set((event.target as HTMLSelectElement).value);
    this.snapshot.set(null);
    this.saveSelection();
    void this.loadSnapshot();
  }

  protected auditLandingPages(): void {
    void this.audits.auditMany(this.landingUrls());
  }

  protected sourceLabel(source: 'GOOGLE_TAG_MANAGER' | 'GOOGLE_ADS' | 'SITE'): string {
    return source === 'SITE' ? 'Fonte: leitura do site' : source === 'GOOGLE_ADS' ? 'Fonte: Google Ads' : 'Fonte: Google Tag Manager API';
  }

  private async loadAccounts(): Promise<void> {
    this.start();
    try {
      const response = await firstValueFrom(this.api.tagManagerAccounts());
      if (!response.status.configured) return this.fail(response.status.reason);
      this.accounts.set(response.data ?? []);
      const saved = this.config.config().gtmContainerPath;
      const account = this.accounts().find((item) => saved.startsWith(`${item.path}/containers/`));
      if (account) {
        this.accountPath.set(account.path);
        await this.loadContainers();
      }
    } catch {
      this.fail('Não foi possível consultar as contas do Tag Manager.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadContainers(): Promise<void> {
    const account = this.accountPath();
    if (!account) return;
    this.start();
    try {
      const response = await firstValueFrom(this.api.tagManagerContainers(account));
      if (!response.status.configured) return this.fail(response.status.reason);
      this.containers.set(response.data ?? []);
      const saved = this.config.config().gtmContainerPath;
      if (this.containers().some((item) => item.path === saved)) {
        this.containerPath.set(saved);
        await this.loadWorkspaces();
      }
    } catch {
      this.fail('Não foi possível consultar os contêineres do Tag Manager.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadWorkspaces(): Promise<void> {
    const container = this.containerPath();
    if (!container) return;
    this.start();
    try {
      const response = await firstValueFrom(this.api.tagManagerWorkspaces(container));
      if (!response.status.configured) return this.fail(response.status.reason);
      this.workspaces.set(response.data ?? []);
      const saved = this.config.config().gtmWorkspacePath;
      if (this.workspaces().some((item) => item.path === saved)) {
        this.workspacePath.set(saved);
        await this.loadSnapshot();
      }
    } catch {
      this.fail('Não foi possível consultar os espaços de trabalho do Tag Manager.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadSnapshot(): Promise<void> {
    const workspace = this.workspacePath();
    if (!workspace) return;
    this.start();
    try {
      const response = await firstValueFrom(this.api.tagManagerSnapshot(workspace));
      if (!response.status.configured) return this.fail(response.status.reason);
      this.snapshot.set(response.data);
      if (response.data) this.history.capture(response.data);
      this.saveSelection();
    } catch {
      this.fail('Não foi possível consultar as tags desse espaço de trabalho.');
    } finally {
      this.loading.set(false);
    }
  }

  private start(): void {
    this.loading.set(true);
    this.problem.set('');
  }

  private fail(reason?: string): void {
    this.problem.set(reason ?? 'A integração com o Tag Manager não está disponível.');
  }

  private saveSelection(): void {
    this.config.update({ gtmContainerPath: this.containerPath(), gtmWorkspacePath: this.workspacePath() });
  }
}
