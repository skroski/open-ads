import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormField, FormRoot, form, max, min } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { BusinessConfigStore } from '../../core/business-config.store';
import { Backup } from '../../core/backup';
import { LocalDb } from '../../core/local-db';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { BRAND, DONATION } from '../../brand';
import { parseTermList } from '../../domain/classify';
import { AuditRules, ServiceHours } from '../../domain/models';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';

const WEEKDAYS: ReadonlyArray<{ key: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; label: string; n: number }> = [
  { key: 'mon', label: 'Seg', n: 1 },
  { key: 'tue', label: 'Ter', n: 2 },
  { key: 'wed', label: 'Qua', n: 3 },
  { key: 'thu', label: 'Qui', n: 4 },
  { key: 'fri', label: 'Sex', n: 5 },
  { key: 'sat', label: 'Sáb', n: 6 },
  { key: 'sun', label: 'Dom', n: 7 },
];

function rulesToText(r: AuditRules): { brand: string; unqualified: string; qualified: string; competitor: string } {
  return {
    brand: r.brandTerms.join(', '),
    unqualified: r.unqualifiedTerms.join(', '),
    qualified: r.qualifiedTerms.join(', '),
    competitor: r.competitorTerms.join(', '),
  };
}

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, FormRoot, Icon, PageHeader, RouterLink],
  template: `
    <app-page-header data-open-help="configuracoes-introducao"
      group="Sistema"
      [refresh]="false"
      title="Configurações"
      subtitle="Regras de classificação, área de atendimento, integrações e backup. Tudo é salvo por conta."
    />

    <div class="flex flex-col gap-block">
      <!-- Regras de auditoria -->
      <section class="card card-border bg-base-100" data-open-help="configuracoes-regras">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="tag" size="sm" /> Regras de classificação dos termos</h2>
            <p class="text-sm text-base-content/70">
              Definem como cada busca e palavra-chave é classificada. A correspondência é por palavra inteira:
              "ia" não casa com "odontologia". Separe por vírgula ou por linha.
            </p>
          </div>
          <form [formRoot]="rulesForm" class="grid gap-4 md:grid-cols-2">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Marca (clientes que já conhecem você)</legend>
              <textarea class="textarea h-28 w-full font-mono text-xs" [formField]="rulesForm.brand"></textarea>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Sem intenção de compra</legend>
              <textarea class="textarea h-28 w-full font-mono text-xs" [formField]="rulesForm.unqualified"></textarea>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Intenção comercial (alvo)</legend>
              <textarea class="textarea h-28 w-full font-mono text-xs" [formField]="rulesForm.qualified"></textarea>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Concorrentes</legend>
              <textarea class="textarea h-28 w-full font-mono text-xs" [formField]="rulesForm.competitor"></textarea>
            </fieldset>
            <div class="flex flex-wrap justify-between gap-2 md:col-span-2">
              <button type="button" class="btn btn-ghost btn-sm" (click)="resetRules()">Restaurar padrões</button>
              <button type="submit" class="btn btn-sm">Salvar regras</button>
            </div>
          </form>
        </div>
      </section>

      <!-- Área e horário de atendimento -->
      <section class="card card-border bg-base-100" data-open-help="configuracoes-area">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="map-pin" size="sm" /> Área e horário de atendimento</h2>
            <p class="text-sm text-base-content/70">
              Cliques fora da área atendida só são tratados como desperdício se você disser onde atende. A
              segmentação das campanhas pode ser diferente da área que a empresa realmente cobre.
            </p>
          </div>

          <div class="grid gap-block lg:grid-cols-2">
            <div>
              <h3 class="mb-2 text-sm font-semibold">Regiões onde a empresa atende</h3>
              @if (regionOptions().length) {
                <ul class="grid gap-1 sm:grid-cols-2">
                  @for (r of regionOptions(); track r.id) {
                    <li>
                      <label class="label cursor-pointer justify-start gap-2">
                        <input
                          type="checkbox"
                          class="checkbox checkbox-sm"
                          [checked]="inArea(r.id)"
                          (change)="toggleRegion(r.id, r.name)"
                        />
                        <span class="text-sm">{{ r.name }}</span>
                      </label>
                    </li>
                  }
                </ul>
                <p class="mt-2 text-xs text-base-content/60">
                  Lista das regiões que já receberam cliques no período selecionado.
                </p>
              } @else {
                <p class="text-sm text-base-content/60">
                  Ainda não há regiões carregadas. Abra a tela de Desperdícios uma vez para buscar as regiões
                  que receberam cliques.
                </p>
              }
              @if (areaCount() === 0) {
                <p class="mt-2 text-xs text-warning">Área ainda não configurada.</p>
              }
            </div>

            <form [formRoot]="hoursForm" class="flex flex-col gap-3">
              <h3 class="text-sm font-semibold">Horário de atendimento humano</h3>
              <label class="label cursor-pointer justify-start gap-3">
                <input type="checkbox" class="toggle toggle-sm" [formField]="hoursForm.enabled" />
                <span class="text-sm">Considerar o horário de atendimento</span>
              </label>
              @if (hoursForm.enabled().value()) {
                <div class="grid grid-cols-2 gap-3">
                  <fieldset class="fieldset">
                    <legend class="fieldset-legend">Abre às (h)</legend>
                    <input type="number" class="input input-sm w-full" [formField]="hoursForm.start" />
                  </fieldset>
                  <fieldset class="fieldset">
                    <legend class="fieldset-legend">Fecha às (h)</legend>
                    <input type="number" class="input input-sm w-full" [formField]="hoursForm.end" />
                  </fieldset>
                </div>
                <div class="flex flex-wrap gap-3">
                  <label class="label cursor-pointer gap-1"><input type="checkbox" class="checkbox checkbox-xs" [formField]="hoursForm.mon" /> Seg</label>
                  <label class="label cursor-pointer gap-1"><input type="checkbox" class="checkbox checkbox-xs" [formField]="hoursForm.tue" /> Ter</label>
                  <label class="label cursor-pointer gap-1"><input type="checkbox" class="checkbox checkbox-xs" [formField]="hoursForm.wed" /> Qua</label>
                  <label class="label cursor-pointer gap-1"><input type="checkbox" class="checkbox checkbox-xs" [formField]="hoursForm.thu" /> Qui</label>
                  <label class="label cursor-pointer gap-1"><input type="checkbox" class="checkbox checkbox-xs" [formField]="hoursForm.fri" /> Sex</label>
                  <label class="label cursor-pointer gap-1"><input type="checkbox" class="checkbox checkbox-xs" [formField]="hoursForm.sat" /> Sáb</label>
                  <label class="label cursor-pointer gap-1"><input type="checkbox" class="checkbox checkbox-xs" [formField]="hoursForm.sun" /> Dom</label>
                </div>
              }
              <div><button type="submit" class="btn btn-sm">Salvar horário</button></div>
            </form>
          </div>
        </div>
      </section>

      <!-- Integrações -->
      <section class="card card-border bg-base-100" data-open-help="configuracoes-integracoes">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="plug" size="sm" /> Site e integrações</h2>
            <p class="text-sm text-base-content/70">
              Identificadores usados para cruzar o Google Ads com o Google Analytics, o Search Console e o site.
              O contêiner e o espaço de trabalho do Tag Manager são escolhidos na tela de Rastreamento.
              O acesso aos dados depende das credenciais do servidor; veja o README.
            </p>
          </div>
          <form [formRoot]="integrationForm" class="grid gap-4 md:grid-cols-2">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">ID da propriedade do GA4</legend>
              <input type="text" class="input w-full font-mono" placeholder="Ex.: 123456789" [formField]="integrationForm.ga4" />
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Site no Search Console</legend>
              <input type="text" class="input w-full font-mono" placeholder="https://www.seusite.com.br/ ou sc-domain:seusite.com.br" [formField]="integrationForm.site" />
            </fieldset>
            <fieldset class="fieldset md:col-span-2">
              <legend class="fieldset-legend">Domínios do site (um por linha)</legend>
              <textarea class="textarea h-20 w-full font-mono text-xs" [placeholder]="brand.examples.domain" [formField]="integrationForm.domains"></textarea>
              <p class="label whitespace-normal">
                Só páginas desses domínios (e as usadas nos seus anúncios) podem ser auditadas.
              </p>
            </fieldset>
            <div class="flex flex-wrap gap-2 md:col-span-2">
              <button type="submit" class="btn btn-sm">Salvar</button>
              <a routerLink="/rastreamento" class="btn btn-ghost btn-sm"><app-icon name="tag" size="sm" /> Abrir rastreamento</a>
            </div>
          </form>
        </div>
      </section>

      <!-- Limiares -->
      <section class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="beaker" size="sm" /> Rigor das conclusões</h2>
            <p class="text-sm text-base-content/70">
              Quanto mais baixo o limite de acaso, mais evidência o painel exige antes de falar em desperdício.
            </p>
          </div>
          <form [formRoot]="thresholdForm" class="grid gap-4 sm:grid-cols-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Chance máxima de ser acaso (%)</legend>
              <input type="number" class="input input-sm w-full" [formField]="thresholdForm.alpha" />
              <p class="label whitespace-normal">Padrão: 10%. Com 5% o painel fica mais cauteloso.</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Mínimo de cliques</legend>
              <input type="number" class="input input-sm w-full" [formField]="thresholdForm.minClicks" />
              <p class="label whitespace-normal">Abaixo disso, a conclusão é sempre "falta de dados".</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Acima da meta a partir de (×)</legend>
              <input type="number" step="0.1" class="input input-sm w-full" [formField]="thresholdForm.factor" />
              <p class="label whitespace-normal">Ex.: 1,5 = custo 50% acima da meta.</p>
            </fieldset>
            <div class="sm:col-span-3"><button type="submit" class="btn btn-sm">Salvar rigor</button></div>
          </form>
        </div>
      </section>

      <!-- Dados locais -->
      <section class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base"><app-icon name="database" size="sm" /> Dados salvos neste navegador</h2>
            <p class="text-sm text-base-content/70">
              Leads importados, conteúdos, histórico, hipóteses e aprendizados ficam apenas neste navegador.
              Exporte um backup de vez em quando: limpar os dados do navegador apaga tudo.
            </p>
          </div>
          @if (!db.persistent()) {
            <div role="alert" class="alert alert-warning alert-soft">
              <app-icon name="warning" />
              <span class="text-sm">Armazenamento local indisponível: os dados valem só nesta sessão.</span>
            </div>
          }
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-sm" (click)="backup.download()">
              <app-icon name="download" size="sm" /> Exportar backup
            </button>
            <label class="btn btn-sm">
              <app-icon name="upload" size="sm" /> Importar backup
              <input type="file" accept="application/json,.json" class="hidden" (change)="onImport($event)" />
            </label>
          </div>
        </div>
      </section>

      <!-- Apoie o projeto -->
      <section class="card card-border bg-base-100">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base">
              <app-icon name="heart" class="text-error" size="sm" /> Apoie o desenvolvimento do OpenAds
            </h2>
            <p class="text-sm text-base-content/70">
              O OpenAds é 100% gratuito e open source (GPL-2.0). Nunca haverá obrigação ou cobrança de qualquer tipo.
              Se este sistema te ajudou a identificar desperdícios e economizar dinheiro no Google Ads, qualquer contribuição ajuda a manter e melhorar o projeto ainda mais.
            </p>
          </div>

          <div class="rounded-box border border-base-300 bg-base-200/50 p-4 max-w-md">
            <div class="text-xs font-semibold uppercase tracking-wider text-base-content/60">Chave PIX ({{ donation.pixType }})</div>
            <div class="mt-2 flex items-center justify-between gap-3">
              <code class="font-mono text-base font-bold text-base-content selection:bg-primary/20">{{ donation.pixKey }}</code>
              <button type="button" class="btn btn-sm btn-primary" (click)="copyPix()">
                <app-icon name="copy" size="xs" /> Copiar chave
              </button>
            </div>
            <p class="mt-2 text-xs text-base-content/60">
              Muito obrigado pela colaboração voluntária! ❤️
            </p>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class SettingsPage {
  private readonly cfg = inject(BusinessConfigStore);
  private readonly toast = inject(ToastService);
  private readonly ws = inject(Workspace);
  protected readonly backup = inject(Backup);
  protected readonly brand = BRAND;
  protected readonly donation = DONATION;
  protected readonly db = inject(LocalDb);

  protected async copyPix(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.donation.pixKey);
      this.toast.success('Chave PIX copiada! Muito obrigado pelo apoio.');
    } catch {
      this.toast.warning('Não foi possível copiar automaticamente.');
    }
  }

  // ── Regras de classificação
  private readonly rulesValue = linkedSignal(() => rulesToText(this.cfg.rules()));
  protected readonly rulesForm = form(this.rulesValue, {
    submission: {
      action: async () => {
        const v = this.rulesValue();
        this.cfg.saveRules({
          brandTerms: parseTermList(v.brand),
          unqualifiedTerms: parseTermList(v.unqualified),
          qualifiedTerms: parseTermList(v.qualified),
          competitorTerms: parseTermList(v.competitor),
        });
        this.toast.success('Regras salvas. A classificação foi recalculada.');
        return undefined;
      },
    },
  });

  protected resetRules(): void {
    this.cfg.resetRules();
    this.toast.info('Regras restauradas para o padrão.');
  }

  // ── Área de atendimento
  protected readonly regionOptions = computed(() => {
    const byId = new Map<string, { id: string; name: string; cost: number }>();
    for (const r of this.ws.regions.value() ?? []) {
      const prev = byId.get(r.regionId);
      byId.set(r.regionId, { id: r.regionId, name: r.regionName, cost: (prev?.cost ?? 0) + r.cost });
    }
    return Array.from(byId.values()).sort((a, b) => b.cost - a.cost);
  });

  protected readonly areaCount = computed(() => this.cfg.config().serviceArea.regionIds.length);

  protected inArea(id: string): boolean {
    return this.cfg.config().serviceArea.regionIds.includes(id);
  }

  protected toggleRegion(id: string, name: string): void {
    const area = this.cfg.config().serviceArea;
    const has = area.regionIds.includes(id);
    const regionIds = has ? area.regionIds.filter((x) => x !== id) : [...area.regionIds, id];
    const regionNames = { ...area.regionNames, [id]: name };
    this.cfg.update({ serviceArea: { regionIds, regionNames } });
  }

  // ── Horário de atendimento
  private readonly hoursValue = linkedSignal(() => {
    const h = this.cfg.config().serviceHours;
    const days = new Set(h?.weekdays ?? [1, 2, 3, 4, 5]);
    return {
      enabled: h !== null,
      start: h?.startHour ?? 8,
      end: h?.endHour ?? 18,
      mon: days.has(1),
      tue: days.has(2),
      wed: days.has(3),
      thu: days.has(4),
      fri: days.has(5),
      sat: days.has(6),
      sun: days.has(7),
    };
  });

  protected readonly hoursForm = form(
    this.hoursValue,
    (p) => {
      min(p.start, 0, { message: 'Entre 0 e 23.' });
      max(p.start, 23, { message: 'Entre 0 e 23.' });
      min(p.end, 1, { message: 'Entre 1 e 24.' });
      max(p.end, 24, { message: 'Entre 1 e 24.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.hoursValue();
          if (!v.enabled) {
            this.cfg.update({ serviceHours: null });
          } else {
            const hours: ServiceHours = {
              startHour: v.start,
              endHour: v.end,
              weekdays: WEEKDAYS.filter((d) => v[d.key]).map((d) => d.n),
            };
            this.cfg.update({ serviceHours: hours });
          }
          this.toast.success('Horário de atendimento salvo.');
          return undefined;
        },
      },
    },
  );

  // ── Integrações
  private readonly integrationValue = linkedSignal(() => {
    const c = this.cfg.config();
    return { ga4: c.ga4PropertyId, site: c.searchConsoleSite, domains: c.domains.join('\n') };
  });

  protected readonly integrationForm = form(this.integrationValue, {
    submission: {
      action: async () => {
        const v = this.integrationValue();
        this.cfg.update({
          ga4PropertyId: v.ga4.trim().replace(/^properties\//, ''),
          searchConsoleSite: v.site.trim(),
          domains: parseTermList(v.domains).map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '')),
        });
        this.toast.success('Integrações salvas.');
        return undefined;
      },
    },
  });

  // ── Rigor
  private readonly thresholdValue = linkedSignal(() => {
    const t = this.cfg.config().thresholds;
    return { alpha: Math.round(t.zeroResultAlpha * 100), minClicks: t.minClicks, factor: t.aboveTargetFactor };
  });

  protected readonly thresholdForm = form(
    this.thresholdValue,
    (p) => {
      min(p.alpha, 1, { message: 'Entre 1 e 50.' });
      max(p.alpha, 50, { message: 'Entre 1 e 50.' });
      min(p.minClicks, 1, { message: 'Ao menos 1.' });
      min(p.factor, 1, { message: 'Ao menos 1.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.thresholdValue();
          this.cfg.update({
            thresholds: { zeroResultAlpha: v.alpha / 100, minClicks: v.minClicks, aboveTargetFactor: v.factor },
          });
          this.toast.success('Rigor atualizado.');
          return undefined;
        },
      },
    },
  );

  protected readonly importing = signal(false);

  constructor() {
    this.ws.regions.need();
  }

  protected async onImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importing.set(true);
    try {
      const counts = await this.backup.restore(await file.text());
      const summary = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      this.toast.success(`Backup importado${summary ? `: ${summary}` : ''}.`);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      this.importing.set(false);
    }
  }
}
