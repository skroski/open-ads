import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { days, num, pct, brl } from '@shared/domain/format';
import { evaluateGoal } from '@shared/domain/funnel';
import { STAGE_LABEL, type WasteRow } from '@shared/domain/models';
import { wasteCategory } from '@shared/domain/waste';
import type { IconName } from '@shared/shared/icons';
import { ConfidenceBadge } from '../../components/Badges';
import { DataState } from '../../components/DataState';
import { EChart } from '../../components/EChart';
import { FunnelBars } from '../../components/FunnelBars';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Sparkline } from '../../components/Sparkline';
import { currency, decimal, percent } from '../../lib/format';
import { useAccount } from '../../state/account';
import { useBusinessConfig } from '../../state/config';
import { useInsights } from '../../state/insights';
import { useWorkspace } from '../../state/workspace';

interface HealthItem {
  label: string;
  ok: boolean;
  detail: string;
  route?: string;
}

/** Cores dos vereditos, iguais às do Oficial (`shared/echart.ts`). */
const VERDICT_COLOR = { tracking: '#3d7ea6', performing: '#5c9c2f' } as const;

const CATEGORY_ICON: Record<string, IconName> = {
  TRACKING: 'warning',
  WASTE: 'ban',
  CAMPAIGN: 'folder',
  FUNNEL: 'funnel',
  LANDING_PAGE: 'link',
  CONTENT: 'document',
  DATA_QUALITY: 'database',
};

const CATEGORY_LABEL: Record<string, string> = {
  TRACKING: 'Medição',
  WASTE: 'Desperdício',
  CAMPAIGN: 'Campanha',
  FUNNEL: 'Funil',
  LANDING_PAGE: 'Página',
  CONTENT: 'Conteúdo',
  DATA_QUALITY: 'Qualidade dos dados',
};

const stageLabel = (s: 'CONTACT' | 'QUALIFIED'): string => STAGE_LABEL[s];
const sourceName = (s: 'ADS' | 'CRM' | 'NONE'): string => (s === 'ADS' ? 'Google Ads' : s === 'CRM' ? 'CRM' : 'indisponível');

export function Overview() {
  const ws = useWorkspace();
  const account = useAccount();
  const { config } = useBusinessConfig();
  const insights = useInsights();
  const { funnel, goal } = insights;

  useEffect(() => ws.needCore(), [ws.needCore]);

  const goalLabel = STAGE_LABEL[config.goal.goalStage].toLowerCase();
  const lagText = days(insights.goalLagDays);

  const bars = useMemo(
    () => (funnel ? insights.stageOrder.map((stage) => ({ stage, count: funnel.total.stages[stage].count, source: funnel.total.stages[stage].source })) : []),
    [funnel, insights.stageOrder],
  );

  const goalEval = useMemo(
    () => (funnel ? evaluateGoal(funnel.total, config.goal, config.thresholds.aboveTargetFactor) : null),
    [funnel, config.goal, config.thresholds.aboveTargetFactor],
  );

  const top = insights.openRecommendations.slice(0, 5);

  /** Maiores desperdícios reais em campanhas e termos (lista, não soma: são recortes diferentes). */
  const topWaste = useMemo<WasteRow[]>(
    () =>
      [...insights.waste.campaign, ...insights.waste.term]
        .filter((r) => wasteCategory(r) === 'WASTE')
        .sort((a, b) => b.perf.cost - a.perf.cost)
        .slice(0, 5),
    [insights.waste],
  );

  const dailyRows = ws.daily.value;

  /** Série diária da conta: custo, cliques e conversões, cada um no próprio eixo. */
  const evolution = useMemo<EChartsCoreOption | null>(() => {
    const w = account.window;
    const byDay = new Map<string, { cost: number; clicks: number; conversions: number }>();
    for (const r of dailyRows ?? []) {
      if (r.date < w.from || r.date > w.to) continue;
      const d = byDay.get(r.date) ?? { cost: 0, clicks: 0, conversions: 0 };
      d.cost += r.cost;
      d.clicks += r.clicks;
      d.conversions += r.conversions;
      byDay.set(r.date, d);
    }
    const dates = [...byDay.keys()].sort();
    if (dates.length < 2) return null;
    const label = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const line = (name: string, color: string, axis: number, values: number[], money = false) => ({
      name,
      type: 'line',
      yAxisIndex: axis,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      data: values,
      tooltip: money ? { valueFormatter: (v: number) => brl(v) } : undefined,
    });
    const hidden = { show: false };
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
      grid: { left: 8, right: 8, top: 12, bottom: 34, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates.map(label) },
      yAxis: [
        { type: 'value', min: 0, axisLabel: { formatter: (v: number) => brl(v).replace(',00', '') } },
        { type: 'value', min: 0, axisLabel: hidden, splitLine: hidden },
        { type: 'value', min: 0, axisLabel: hidden, splitLine: hidden },
      ],
      series: [
        line('Custo', '#e98015', 0, dates.map((d) => Math.round((byDay.get(d)?.cost ?? 0) * 100) / 100), true),
        line('Cliques', VERDICT_COLOR.tracking, 1, dates.map((d) => byDay.get(d)?.clicks ?? 0)),
        line('Conversões', VERDICT_COLOR.performing, 2, dates.map((d) => Math.round((byDay.get(d)?.conversions ?? 0) * 10) / 10)),
      ],
    };
  }, [dailyRows, account.window]);

  /** Falhas de medição que tocam o período analisado ou ainda estão em curso. */
  const outagesInPeriod = useMemo(
    () => insights.outages.filter((o) => o.ongoing || o.to >= account.window.from).slice(0, 2),
    [insights.outages, account.window.from],
  );

  const sparkCost = useMemo(() => {
    const w = account.window;
    const byDay = new Map<string, number>();
    for (const r of dailyRows ?? []) {
      if (r.date >= w.from && r.date <= w.to) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.cost);
    }
    return Array.from(byDay.keys())
      .sort()
      .map((d) => byDay.get(d) as number);
  }, [dailyRows, account.window]);

  const costDelta = useMemo(() => {
    const now = funnel?.total.cost ?? 0;
    const prev = (ws.previousCampaigns.value ?? []).reduce((s, c) => s + c.cost, 0);
    if (!prev) return '';
    const change = (now - prev) / prev;
    if (Math.abs(change) < 0.005) return '≈ igual';
    return `${change > 0 ? '+' : '−'}${pct(Math.abs(change), 0)}`;
  }, [funnel, ws.previousCampaigns.value]);

  const health: HealthItem[] = [
    {
      label: 'Google Ads conectado',
      ok: !!ws.campaigns.value,
      detail: `${num(ws.campaigns.value?.length ?? 0)} campanhas lidas`,
    },
    {
      label: 'Conversões classificadas por você',
      ok: !!funnel && funnel.unconfirmedConversions === 0,
      detail:
        funnel && funnel.unconfirmedConversions > 0
          ? `${num(funnel.unconfirmedConversions, 1)} conversões ainda dependem de sugestão automática`
          : 'Cada ação está mapeada para um estágio do funil',
      route: '/funil',
    },
    {
      label: 'Meta de custo definida',
      ok: goal.targetCostPerGoal !== null,
      detail: goal.targetCostPerGoal !== null ? 'Vereditos usam a sua meta' : 'Sem meta, a comparação usa a média da conta',
      route: '/funil',
    },
    {
      label: 'Leads e vendas do CRM',
      ok: !!funnel?.crmPresent,
      detail: funnel?.crmPresent ? 'Qualificação, venda e receita medidas' : 'Sem leads no período: qualidade e ROI indisponíveis',
      route: '/funil',
    },
    {
      label: 'Google Analytics',
      ok: ws.ga4Status.configured,
      detail: ws.ga4Status.configured ? 'Sessões e eventos por página' : (ws.ga4Status.reason ?? 'Não conectado'),
      route: '/configuracoes',
    },
    {
      label: 'Search Console',
      ok: ws.searchConsoleStatus.configured,
      detail: ws.searchConsoleStatus.configured ? 'Consultas e posição orgânica' : (ws.searchConsoleStatus.reason ?? 'Não conectado'),
      route: '/configuracoes',
    },
    {
      label: 'Área de atendimento',
      ok: insights.serviceAreaConfigured,
      detail: insights.serviceAreaConfigured ? 'Regiões fora da área são identificadas' : 'Informe onde a empresa atende',
      route: '/configuracoes',
    },
    {
      label: 'Período maduro',
      ok: insights.maturity >= 0.8,
      detail: `${pct(insights.maturity, 0)} do período já teve tempo de gerar ${goalLabel}`,
    },
  ];

  return (
    <>
      <PageHeader
        helpId="visao-geral-introducao"
        group="Inteligência"
        title="Visão geral"
        subtitle={`Do clique à venda: ${account.rangeLabel.toLowerCase()}. Cada número diz de onde vem; o que não pôde ser medido aparece como indisponível.`}
      />

      <DataState loading={insights.loadingCore} error={insights.coreError} hasData={!!funnel} onRetry={ws.reloadAll}>
        {funnel && (
          <div className="flex flex-col gap-block">
            {/* Alertas que invalidam o resto */}
            {outagesInPeriod.map((o) => (
              <div key={o.from + o.campaignId} role="alert" className="alert alert-warning alert-soft">
                <Icon name="warning" />
                <div className="min-w-0">
                  <h3 className="font-semibold">
                    {o.ongoing ? 'Conversões pararam' : 'Houve um período sem conversões'}{' '}
                    {o.scope === 'ACCOUNT' ? 'na conta' : `em "${o.campaignName}"`}
                  </h3>
                  <div className="text-sm">
                    {o.days} dias seguidos ({o.from} a {o.to}) com {decimal(o.clicks)} cliques e nenhuma conversão registrada.{' '}
                    {o.ongoing
                      ? 'Vale testar o formulário e a etiqueta de medição antes de decidir qualquer corte.'
                      : 'Se a medição já existia, ela falhou nesse trecho; se foi criada depois, esse gasto não pode ser avaliado.'}
                  </div>
                </div>
                <Link to="/acoes" className="btn btn-sm">
                  Ver detalhes
                </Link>
              </div>
            ))}

            {insights.maturity < 0.5 && (
              <div role="status" className="alert alert-info alert-soft">
                <Icon name="clock" />
                <span className="text-sm">
                  Só {percent(insights.maturity)} deste período já teve tempo de gerar {goalLabel} (prazo típico: {lagText}). Evite cortes baseados nele; ele
                  amadurece em {insights.maturesOnDate}.
                </span>
              </div>
            )}

            {/* Números principais */}
            <section aria-label="Resultados do período" data-open-help="visao-geral-resultados">
              <div className="stats w-full">
                <div className="stat">
                  <div className="stat-title">Investimento</div>
                  <div className="stat-value">{currency(funnel.total.cost)}</div>
                  <div className="stat-desc">
                    {decimal(funnel.total.impressions)} impressões · {decimal(funnel.total.clicks)} cliques
                    {costDelta && <> · {costDelta} vs. período anterior</>}
                  </div>
                </div>

                <div className="stat">
                  <div className="stat-title">{stageLabel('CONTACT')}</div>
                  <div className="stat-value">
                    {funnel.total.stages.CONTACT.source === 'NONE' ? <span className="text-base-content/50">—</span> : decimal(funnel.total.stages.CONTACT.count, 0, 1)}
                  </div>
                  <div className="stat-desc">
                    {funnel.total.costPer.CONTACT !== null
                      ? `${currency(funnel.total.costPer.CONTACT)} por contato · ${sourceName(funnel.total.stages.CONTACT.source)}`
                      : 'Sem conversões de contato no período'}
                  </div>
                </div>

                <div className="stat">
                  <div className="stat-title">{stageLabel('QUALIFIED')}</div>
                  <div className="stat-value">
                    {funnel.total.stages.QUALIFIED.source === 'NONE' ? <span className="text-base-content/50">—</span> : decimal(funnel.total.stages.QUALIFIED.count)}
                  </div>
                  <div className="stat-desc">
                    {funnel.total.costPer.QUALIFIED !== null
                      ? `${currency(funnel.total.costPer.QUALIFIED)} por lead qualificado`
                      : funnel.total.stages.QUALIFIED.source === 'NONE'
                        ? 'Indisponível: importe os leads do CRM'
                        : 'Nenhum lead qualificado ainda'}
                  </div>
                </div>

                <div className="stat">
                  <div className="stat-title">Vendas e retorno</div>
                  <div className="stat-value">
                    {funnel.total.stages.SALE.source === 'NONE' ? <span className="text-base-content/50">—</span> : decimal(funnel.total.stages.SALE.count)}
                  </div>
                  <div className="stat-desc">
                    {funnel.total.revenue !== null ? (
                      <>
                        {currency(funnel.total.revenue)} de receita
                        {funnel.total.roi !== null && <> · ROI {percent(funnel.total.roi)}</>}
                      </>
                    ) : (
                      'Receita e ROI só existem com vendas do CRM'
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Evolução do período */}
            {evolution && (
              <section className="card card-border bg-base-100">
                <div className="card-body gap-4">
                  <h2 className="text-base font-semibold">Evolução do período</h2>
                  <p className="text-sm text-base-content/70">Custo, cliques e conversões do Google Ads por dia. Cada linha usa a própria escala.</p>
                  <EChart option={evolution} height={280} label="Custo, cliques e conversões por dia no período" />
                </div>
              </section>
            )}

            <div className="grid gap-block lg:grid-cols-5">
              {/* Funil */}
              <section className="card card-border bg-base-100 lg:col-span-3">
                <div className="card-body gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="card-title text-base">Funil do período</h2>
                      <p className="text-sm text-base-content/70">Um clique não é um contato, e um contato não é um lead qualificado.</p>
                    </div>
                    <Link to="/funil" className="btn btn-ghost btn-sm">
                      Detalhar
                    </Link>
                  </div>
                  <FunnelBars bars={bars} />
                  {funnel.adsValue.isStatic && (
                    <div role="note" className="alert alert-soft alert-warning">
                      <Icon name="info" />
                      <span className="text-sm">
                        O Google Ads atribui o mesmo valor a cada conversão ({funnel.adsValue.perConversion !== null ? currency(funnel.adsValue.perConversion) : ''}). Isso não é receita e não entra no ROI.
                      </span>
                    </div>
                  )}
                </div>
              </section>

              {/* Meta */}
              <section className="card card-border bg-base-100 lg:col-span-2">
                <div className="card-body gap-4">
                  <h2 className="card-title text-base">Seu bom resultado</h2>
                  <p className="text-sm text-base-content/70">
                    {config.goal.targetCostPerGoal !== null
                      ? `Meta: ${goalLabel} a até ${currency(config.goal.targetCostPerGoal)} cada.`
                      : `Meta: ${goalLabel}. Defina quanto vale pagar para avaliar com uma régua sua.`}
                  </p>

                  {goalEval && (
                    <>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <div className="text-3xl font-semibold tabular">
                            {goalEval.costPerGoal !== null ? currency(goalEval.costPerGoal) : <span className="text-base-content/40">—</span>}
                          </div>
                          <div className="text-sm text-base-content/70">por {goalLabel}</div>
                        </div>
                        {sparkCost.length > 1 && (
                          <div className="text-base-content/70">
                            <Sparkline values={sparkCost} label="Custo diário no período" />
                            <div className="text-right text-xs">custo por dia</div>
                          </div>
                        )}
                      </div>

                      <div>
                        {goalEval.status === 'MET' ? (
                          <span className="badge badge-soft badge-success">Dentro da meta</span>
                        ) : goalEval.status === 'ABOVE' ? (
                          <span className="badge badge-soft badge-warning">Acima da meta</span>
                        ) : goalEval.status === 'NO_TARGET' ? (
                          <span className="badge badge-soft">Sem meta definida</span>
                        ) : goalEval.status === 'NO_RESULTS' ? (
                          <span className="badge badge-soft badge-error">Nenhum resultado no período</span>
                        ) : (
                          <span className="badge badge-dash">Sem dados deste estágio</span>
                        )}
                      </div>
                    </>
                  )}
                  <Link to="/funil" className="btn btn-sm self-start">
                    Configurar meta
                  </Link>
                </div>
              </section>
            </div>

            {/* Onde olhar primeiro */}
            <section className="card card-border bg-base-100" data-open-help="visao-geral-prioridades">
              <div className="card-body gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="card-title text-base">Onde olhar primeiro</h2>
                    <p className="text-sm text-base-content/70">Ordenado por impacto estimado e confiança. Cada item mostra a evidência e como validar.</p>
                  </div>
                  <Link to="/acoes" className="btn btn-ghost btn-sm">
                    Todas ({insights.openRecommendations.length})
                  </Link>
                </div>

                <ul className="list">
                  {top.map((r) => (
                    <li key={r.id} className="list-row items-center">
                      <span className="grid size-9 place-items-center rounded-box bg-base-200">
                        <Icon name={CATEGORY_ICON[r.category] ?? 'info'} size="sm" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium break-words">{r.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
                          <span>{CATEGORY_LABEL[r.category] ?? r.category}</span>
                          {r.impact.monthlyCostBrl ? <span>· até {currency(r.impact.monthlyCostBrl, 0, 0)}/mês</span> : null}
                        </div>
                      </div>
                      <ConfidenceBadge level={r.confidence.level} />
                      <Link to="/acoes" className="btn btn-ghost btn-sm btn-square" aria-label="Abrir no plano de ação">
                        <Icon name="arrow-right" size="sm" />
                      </Link>
                    </li>
                  ))}
                  {top.length === 0 && (
                    <li className="list-row text-sm text-base-content/60">Nenhuma recomendação aberta. Isso pode mudar quando mais dados chegarem.</li>
                  )}
                </ul>
              </div>
            </section>

            <div className="grid gap-block lg:grid-cols-2">
              {/* Desperdícios identificados */}
              <section className="card card-border bg-base-100">
                <div className="card-body gap-0 p-0">
                  <div className="flex items-start justify-between gap-3 px-6 pt-4 pb-2">
                    <div>
                      <h2 className="text-base font-semibold">Desperdícios identificados</h2>
                      <p className="text-sm text-base-content/70">Campanhas e termos sem resultado, do maior gasto para o menor.</p>
                    </div>
                    <Link to="/desperdicios" className="link-brand whitespace-nowrap text-sm">
                      Ver todos »
                    </Link>
                  </div>
                  <ul>
                    {topWaste.map((w) => (
                      <li key={w.dimension + w.key} className="flex items-center justify-between gap-3 border-t border-base-300 px-6 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium break-words">{w.label}</div>
                          <div className="text-xs text-base-content/60">
                            {w.dimension === 'campaign' ? 'Campanha' : 'Termo'} · {decimal(w.perf.clicks)} cliques, nenhum resultado
                            {w.blocked && ' · já bloqueado'}
                          </div>
                        </div>
                        <div className="flex flex-none flex-col items-end gap-1">
                          <span className="font-display text-base font-medium tabular">{brl(w.perf.cost)}</span>
                          <span className={w.assessment.confidence.level === 'HIGH' ? 'badge badge-soft badge-xs badge-error' : 'badge badge-soft badge-xs badge-warning'}>
                            {w.assessment.confidence.level === 'HIGH' ? 'Crítico' : 'Atenção'}
                          </span>
                        </div>
                      </li>
                    ))}
                    {topWaste.length === 0 && (
                      <li className="border-t border-base-300 px-6 py-4 text-sm text-base-content/60">Nenhum desperdício confirmado em campanhas ou termos neste período.</li>
                    )}
                  </ul>
                </div>
              </section>

              {/* Saúde dos dados */}
              <section className="card card-border bg-base-100" data-open-help="visao-geral-saude">
                <div className="card-body gap-4">
                  <h2 className="card-title text-base">Saúde dos dados</h2>
                  <p className="text-sm text-base-content/70">Quanto mais completo, mais firmes ficam as conclusões.</p>
                  <ul className="flex flex-col gap-2">
                    {health.map((h) => (
                      <li key={h.label} className="flex items-start gap-3 text-sm">
                        <span
                          className={
                            h.ok
                              ? 'mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-success text-success-content'
                              : 'mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-base-300 text-base-content/70'
                          }
                        >
                          <Icon name={h.ok ? 'check' : 'x'} size="xs" stroke={2.5} />
                        </span>
                        <div className="min-w-0 grow">
                          <div className="font-medium">{h.label}</div>
                          <div className="text-xs text-base-content/60">{h.detail}</div>
                        </div>
                        {!h.ok && h.route && (
                          <Link to={h.route} className="btn btn-ghost btn-xs">
                            Resolver
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            </div>
          </div>
        )}
      </DataState>
    </>
  );
}
