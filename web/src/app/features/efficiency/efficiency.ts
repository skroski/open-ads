import { CurrencyPipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Insights } from '../../core/insights';
import { Workspace } from '../../core/workspace';
import { PageAudits } from '../../core/page-audits';
import { efficiencyAdvice, MediaScope, placementCoverage } from '../../domain/efficiency';
import { CHANNEL_LABEL, brl } from '../../domain/format';
import { STAGE_LABEL, WasteDimension } from '../../domain/models';
import { categoryTotals } from '../../domain/waste';
import { ConfidenceBadge, VerdictBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { EvidenceList } from '../../shared/evidence-list';
import { Icon } from '../../shared/icon';
import { PageHeader, ExportData } from '../../shared/page-header';
import { SOURCE_LABEL } from '../../shared/labels';

const FORMATS: MediaScope[] = [
  'DISPLAY',
  'SEARCH',
  'PERFORMANCE_MAX',
  'VIDEO',
  'SHOPPING',
  'DEMAND_GEN',
  'OTHER',
  'ALL',
];
const DIMENSIONS: { key: WasteDimension; label: string }[] = [
  { key: 'campaign', label: 'Campanhas' },
  { key: 'placement', label: 'Onde os anúncios aparecem' },
  { key: 'ad', label: 'Anúncios e criativos' },
  { key: 'page', label: 'Páginas de destino' },
  { key: 'term', label: 'Termos de busca' },
  { key: 'keyword', label: 'Palavras-chave' },
  { key: 'hour', label: 'Dias e horários' },
  { key: 'device', label: 'Dispositivos' },
  { key: 'region', label: 'Regiões' },
];

@Component({
  selector: 'app-efficiency-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    RouterLink,
    ConfidenceBadge,
    VerdictBadge,
    DataState,
    EvidenceList,
    Icon,
    PageHeader,
  ],
  templateUrl: './efficiency.html',
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .efficiency-control {
      min-height: 44px;
    }
    summary {
      cursor: pointer;
      min-height: 44px;
      align-content: center;
    }
    summary:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 4px;
      border-radius: 4px;
    }
  `,
})
export class EfficiencyPage {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  protected readonly audits = inject(PageAudits);
  readonly format = input<string | undefined>();
  readonly dim = input<string | undefined>();
  protected readonly formats = FORMATS;
  protected readonly sourceLabel = SOURCE_LABEL;
  protected readonly channel = linkedSignal<MediaScope>(() =>
    FORMATS.includes(this.format() as MediaScope) ? (this.format() as MediaScope) : 'DISPLAY',
  );
  protected readonly campaigns = computed(() =>
    (this.ws.campaigns.value() ?? []).filter(
      (c) => this.channel() === 'ALL' || c.channel === this.channel(),
    ),
  );
  protected readonly campaignId = linkedSignal({ source: this.campaigns, computation: () => '' });
  protected readonly dimensions = computed(() =>
    DIMENSIONS.filter((d) => {
      if (
        (d.key === 'region' || d.key === 'device') &&
        (this.channel() !== 'ALL' || this.campaignId())
      )
        return false;
      if (
        (d.key === 'term' || d.key === 'keyword') &&
        this.channel() !== 'SEARCH' &&
        this.channel() !== 'ALL'
      )
        return false;
      return d.key !== 'placement' || this.channel() === 'DISPLAY' || this.channel() === 'ALL';
    }),
  );
  protected readonly dimension = linkedSignal<WasteDimension>(() => {
    const dim = this.dim();
    return this.dimensions().some((d) => d.key === dim) ? (dim as WasteDimension) : 'campaign';
  });
  protected readonly filter = signal('ALL');
  protected readonly query = signal('');
  protected readonly shown = linkedSignal(() => {
    this.channel();
    this.campaignId();
    this.dimension();
    this.filter();
    this.query();
    return 12;
  });
  protected readonly report = computed(() =>
    this.insights.efficiency(this.channel(), this.campaignId()),
  );
  protected readonly campaignRows = computed(() => this.report().campaign);
  protected readonly totalCost = computed(() =>
    this.campaignRows().reduce((s, r) => s + r.perf.cost, 0),
  );
  protected readonly totals = computed(() => categoryTotals(this.campaignRows()));
  protected readonly reviewCost = computed(
    () => this.totals().WASTE.cost + this.totals().EXPENSIVE.cost + this.totals().TRACKING.cost,
  );
  protected readonly rows = computed(() => this.report()[this.dimension()]);
  protected readonly advice = computed(() =>
    this.rows()
      .filter((r) => this.dimension() !== 'hour' || r.key.startsWith('h:'))
      .map((r) => efficiencyAdvice(r, this.insights.goal(), this.insights.window()))
      .filter(
        (a) =>
          this.filter() === 'ALL' ||
          (this.filter() === 'REVIEW'
            ? a.priority <= 2
            : this.filter() === 'GOOD'
              ? a.row.assessment.verdict === 'PERFORMING'
              : a.row.assessment.verdict === 'INSUFFICIENT_DATA'),
      )
      .filter((a) =>
        `${a.row.label} ${a.row.sublabel ?? ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(this.query().trim().toLocaleLowerCase('pt-BR')),
      )
      .sort((a, b) => a.priority - b.priority || b.row.perf.cost - a.row.perf.cost),
  );
  protected readonly visible = computed(() => this.advice().slice(0, this.shown()));
  protected readonly goalLabel = computed(() => STAGE_LABEL[this.insights.goal().goalStage]);
  protected readonly title = computed(() => {
    if (!this.campaignRows().length) return 'Sem campanhas com gasto neste recorte';
    if (this.totals().TRACKING.cost > 0) return 'Confira a medição antes de cortar investimento';
    if (this.reviewCost() > 0) return 'Há gastos que merecem uma revisão';
    if (this.totals().UNKNOWN.cost > 0) return 'Ainda precisamos de mais dados para decidir';
    return 'Acompanhe o que está trazendo resultado';
  });
  protected readonly period = computed(() => {
    const w = this.insights.window();
    const date = (d: string) => d.split('-').reverse().join('/');
    return `${date(w.from)} a ${date(w.to)}`;
  });
  protected readonly placementNote = computed(() =>
    placementCoverage(
      this.report().placement.reduce((s, r) => s + r.perf.cost, 0),
      this.totalCost(),
    ),
  );
  protected readonly dimensionLoading = computed(() =>
    ({
      campaign: this.ws.campaigns,
      placement: this.ws.placements,
      ad: this.ws.ads,
      page: this.ws.landingPages,
      term: this.ws.searchTermsRaw,
      keyword: this.ws.keywordMetrics,
      hour: this.ws.hours,
      device: this.ws.devices,
      region: this.ws.regions,
    })[this.dimension()].loading(),
  );
  protected readonly dimensionError = computed(() =>
    ({
      campaign: this.ws.campaigns,
      placement: this.ws.placements,
      ad: this.ws.ads,
      page: this.ws.landingPages,
      term: this.ws.searchTermsRaw,
      keyword: this.ws.keywordMetrics,
      hour: this.ws.hours,
      device: this.ws.devices,
      region: this.ws.regions,
    })[this.dimension()].error(),
  );
  protected readonly ga4State = computed(() =>
    this.ws.ga4Pages.loading()
      ? 'Carregando'
      : this.ws.ga4Pages.error()
        ? 'Falha na consulta'
        : this.ws.ga4Pages.value()?.status.configured
          ? 'Disponível por página'
          : 'Não conectado',
  );
  protected readonly gscState = computed(() =>
    this.ws.gscPages.loading()
      ? 'Carregando'
      : this.ws.gscPages.error()
        ? 'Falha na consulta'
        : this.ws.gscPages.value()?.status.configured
          ? 'Disponível para conteúdo'
          : 'Não conectado',
  );
  protected readonly auditedCount = computed(
    () =>
      new Set(
        (this.ws.landingPages.value() ?? [])
          .filter(
            (p) =>
              this.campaigns().some((c) => c.id === p.campaignId) &&
              (!this.campaignId() || p.campaignId === this.campaignId()),
          )
          .filter((p) => this.audits.get(p.url))
          .map((p) => p.normalizedUrl),
      ).size,
  );
  protected readonly exportData = computed<ExportData>(() => ({
    name: `eficiencia-${this.channel().toLowerCase()}-${this.dimension()}`,
    rows: this.advice().map((a) => ({
      Início: this.insights.window().from,
      Fim: this.insights.window().to,
      Formato: this.formatLabel(this.channel()),
      Recorte: this.dimension(),
      Item: a.row.label,
      Detalhe: a.row.sublabel ?? '',
      'Fonte do gasto': 'Google Ads',
      'Gasto (R$)': a.row.perf.cost,
      Cliques: a.row.perf.clicks,
      'Resultado avaliado': this.goalLabel(),
      Resultados: a.row.outcomesKnown === false ? null : a.row.outcomes,
      'Fonte do resultado':
        a.row.outcomesKnown === false
          ? 'Indisponível'
          : SOURCE_LABEL[a.row.outcomeSource ?? 'GOOGLE_ADS'],
      Prioridade: a.priorityLabel,
      Conclusão: a.headline,
      Confiança: a.row.assessment.confidence.level,
      'Fatos e fontes': a.facts.map((e) => `${e.source}: ${e.text}`).join(' | '),
      Hipóteses: a.hypotheses.map((e) => e.text).join(' | '),
      'Falta saber': a.missing.map((e) => e.text).join(' | '),
      'Próxima ação': a.action,
      'Como avaliar': a.validation,
      'Diferença histórica para meta (R$)': a.impact.amount,
      'Premissas do impacto': a.impact.basis,
    })),
  }));
  protected formatLabel = (value: MediaScope): string =>
    value === 'ALL' ? 'Todos os formatos' : (CHANNEL_LABEL[value] ?? value);
  protected money = brl;
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected changeFormat(event: Event): void {
    const value = this.value(event) as MediaScope;
    if (FORMATS.includes(value)) {
      this.channel.set(value);
      this.filter.set('ALL');
      this.query.set('');
    }
  }
  protected changeDimension(event: Event): void {
    const value = this.value(event) as WasteDimension;
    if (this.dimensions().some((d) => d.key === value)) {
      this.dimension.set(value);
      this.filter.set('ALL');
      this.query.set('');
    }
  }
  protected async readPages(): Promise<void> {
    const ids = new Set(
      this.campaigns()
        .filter((c) => !this.campaignId() || c.id === this.campaignId())
        .map((c) => c.id),
    );
    await this.audits.auditMany(
      (this.ws.landingPages.value() ?? []).filter((p) => ids.has(p.campaignId)).map((p) => p.url),
    );
  }
  constructor() {
    this.insights.needCore();
  }
}
