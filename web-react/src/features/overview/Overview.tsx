import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { brl, num, pct } from '@shared/domain/format';
import { evaluateGoal } from '@shared/domain/funnel';
import { STAGE_LABEL, type FunnelStage } from '@shared/domain/models';
import type { RecommendationView } from '../../state/insights';
import type { IconName } from '@shared/shared/icons';
import { ConfidenceBadge } from '../../components/Badges';
import { DataState } from '../../components/DataState';
import { EChart } from '../../components/EChart';
import { Icon } from '../../components/Icon';
import { useAccount } from '../../state/account';
import { useBusinessConfig } from '../../state/config';
import { useInsights } from '../../state/insights';
import { useWorkspace } from '../../state/workspace';

interface DashboardKpi {
  label: string;
  value: string;
  comparison: string;
  reference: string;
  interpretation: string;
  source: string;
  confidence: string;
  unavailable?: boolean;
}

interface VerdictFact {
  label: string;
  value: string;
  note: string;
}

interface DashboardVerdict {
  state: string;
  tone: 'attention' | 'risk' | 'healthy' | 'neutral';
  headline: string;
  reason: string;
  action: string;
  route: string;
  facts: VerdictFact[];
}

interface FlowStage {
  label: string;
  value: string;
  note: string;
  source: string;
  available: boolean;
  warning: boolean;
}

const DECISION_LABEL: Record<string, string> = {
  TRACKING: 'Investigar primeiro',
  WASTE: 'Corrigir agora',
  CAMPAIGN: 'Investigar primeiro',
  FUNNEL: 'Melhorar a medição',
  LANDING_PAGE: 'Investigar primeiro',
  CONTENT: 'Preparar oportunidade',
  DATA_QUALITY: 'Completar a leitura',
};

const sourceName = (source: 'ADS' | 'CRM' | 'NONE') =>
  source === 'ADS' ? 'Google Ads' : source === 'CRM' ? 'CRM' : 'Indisponível';

/** Tela de entrada: decisão, evidência e limites dos dados antes do detalhe técnico. */
export function Overview() {
  const ws = useWorkspace();
  const account = useAccount();
  const { config } = useBusinessConfig();
  const insights = useInsights();
  const { funnel, outages, openRecommendations, maturity, loadingCore, coreError } = insights;
  const f = funnel;

  useEffect(() => {
    ws.needCore();
  }, [ws]);

  const goalLabel = useMemo(() => STAGE_LABEL[config.goal.goalStage].toLowerCase(), [config.goal.goalStage]);
  const top = useMemo(() => openRecommendations.slice(0, 5), [openRecommendations]);

  const outagesInPeriod = useMemo(() => {
    const from = account.window.from;
    return outages.filter((outage) => outage.ongoing || outage.to >= from);
  }, [account.window.from, outages]);

  const goalEval = useMemo(() => {
    return f ? evaluateGoal(f.total, config.goal, config.thresholds.aboveTargetFactor) : null;
  }, [f, config.goal, config.thresholds.aboveTargetFactor]);

  const readingConfidence = useMemo(() => {
    if (!f) return { label: 'Indisponível', note: 'A leitura ainda não terminou.' };
    if (outagesInPeriod.length) return { label: 'Baixa', note: 'Há conversões interrompidas no período.' };
    if (!f.crmPresent || maturity < 0.8) {
      return {
        label: 'Média',
        note: !f.crmPresent
          ? 'O CRM não está conectado para confirmar vendas.'
          : `${pct(maturity, 0)} do período já amadureceu.`,
      };
    }
    return { label: 'Alta', note: 'Fontes e maturidade suficientes para esta leitura.' };
  }, [f, outagesInPeriod.length, maturity]);

  const verdict = useMemo<DashboardVerdict>(() => {
    const target = config.goal.targetCostPerGoal;
    const confidence = readingConfidence;
    const goal = goalEval;
    const outcomeLabel = goalLabel;
    const facts: VerdictFact[] = [
      {
        label: 'Referência',
        value: target === null ? 'Não definida' : brl(target),
        note: target === null ? `Defina o custo aceitável por ${outcomeLabel}.` : `Por ${outcomeLabel}.`,
      },
      {
        label: 'Período maduro',
        value: pct(maturity, 0),
        note: `Janela para gerar ${outcomeLabel}.`,
      },
      { label: 'Confiança da leitura', value: confidence.label, note: confidence.note },
    ];

    if (!f || !goal) {
      return {
        state: 'Sem dados',
        tone: 'neutral',
        headline: 'Ainda não há dados suficientes para concluir.',
        reason: 'Conclua a leitura da conta antes de decidir sobre orçamento ou cortes.',
        action: 'Ver medição',
        route: '/funil',
        facts,
      };
    }

    const outage = outagesInPeriod[0];
    if (outage) {
      return {
        state: 'Medição em risco',
        tone: 'risk',
        headline: 'Há um trecho sem conversões registradas que precisa ser investigado antes de otimizar a conta.',
        reason: `${outage.days} dias com ${num(outage.clicks)} cliques e nenhuma conversão registrada. Esse período não deve sustentar cortes ou aumentos de orçamento.`,
        action: 'Verificar medição',
        route: '/funil',
        facts,
      };
    }

    if (target === null) {
      return {
        state: 'Sem referência',
        tone: 'neutral',
        headline: `Há resultado, mas ainda não existe uma régua para avaliar o custo por ${outcomeLabel}.`,
        reason: `O painel mostra o custo observado; a conclusão depende de você definir quanto vale pagar por ${outcomeLabel}.`,
        action: 'Definir referência',
        route: '/funil',
        facts,
      };
    }

    if (goal.status === 'ABOVE') {
      const cpo = goal.costPerGoal === null ? '—' : brl(goal.costPerGoal);
      return {
        state: 'Atenção',
        tone: 'attention',
        headline: `O custo por ${outcomeLabel} está em ${cpo}, acima da sua referência.`,
        reason: 'Revise as oportunidades antes de aumentar o orçamento. Custo alto é um sinal para investigar, não uma ordem para pausar.',
        action: 'Revisar oportunidades',
        route: '/oportunidades',
        facts,
      };
    }

    if (goal.status === 'NO_RESULTS' || goal.status === 'NO_DATA') {
      return {
        state: 'Sem conclusão',
        tone: 'neutral',
        headline: `Ainda não há ${outcomeLabel} suficiente para comparar o custo com segurança.`,
        reason: 'Espere mais dados ou confira se a conversão está configurada antes de interpretar o investimento.',
        action: 'Ver medição',
        route: '/funil',
        facts,
      };
    }

    return {
      state: 'Dentro da referência',
      tone: 'healthy',
      headline: `O custo por ${outcomeLabel} está dentro da referência definida para a conta.`,
      reason: 'Acompanhe as oportunidades abertas e a maturação do período antes de ampliar o investimento.',
      action: 'Ver oportunidades',
      route: '/oportunidades',
      facts,
    };
  }, [config.goal.targetCostPerGoal, readingConfidence, goalEval, goalLabel, maturity, f, outagesInPeriod]);

  const costDelta = useMemo(() => {
    const now = f?.total.cost ?? 0;
    const previous = (ws.previousCampaigns.value ?? []).reduce((sum, campaign) => sum + campaign.cost, 0);
    if (!previous) return 'Sem comparação anterior disponível.';
    const change = (now - previous) / previous;
    if (Math.abs(change) < 0.005) return 'Praticamente igual ao período anterior.';
    return `${change > 0 ? '+' : '−'}${pct(Math.abs(change), 0)} vs. período anterior.`;
  }, [f?.total.cost, ws.previousCampaigns.value]);

  const kpis = useMemo<DashboardKpi[]>(() => {
    if (!f) return [];
    const goalStage = config.goal.goalStage;
    const outcome = f.total.stages[goalStage];
    const cost = f.total.costPer[goalStage];
    const target = config.goal.targetCostPerGoal;
    const confidence = readingConfidence.label.toLowerCase();
    const targetReference =
      target === null ? `Defina uma referência para ${goalLabel}.` : `Referência: ${brl(target)} por ${goalLabel}.`;

    return [
      {
        label: 'Investimento',
        value: brl(f.total.cost),
        comparison: costDelta,
        reference: `${num(f.total.impressions)} impressões e ${num(f.total.clicks)} cliques.`,
        interpretation: 'O investimento mostra o tamanho da aposta; sozinho, não diz se ela foi bem usada.',
        source: 'Google Ads',
        confidence: `Confiança ${confidence}`,
      },
      {
        label: STAGE_LABEL[goalStage],
        value: outcome.source === 'NONE' ? '—' : num(outcome.count, 1),
        comparison: outcome.source === 'NONE' ? 'Indisponível' : `${goalLabel} registrados no período.`,
        reference: outcome.source === 'NONE' ? 'A fonte desse estágio não está conectada.' : `Fonte: ${sourceName(outcome.source)}.`,
        interpretation:
          outcome.source === 'NONE'
            ? 'A ausência de fonte não é zero: conecte ou importe os dados necessários.'
            : 'Este é o resultado mais profundo disponível para a leitura atual.',
        source: sourceName(outcome.source),
        confidence: `Confiança ${confidence}`,
        unavailable: outcome.source === 'NONE',
      },
      {
        label: `Custo por ${goalLabel}`,
        value: cost === null ? '—' : brl(cost),
        comparison: cost === null ? 'Sem resultado suficiente para calcular.' : targetReference,
        reference: target === null ? 'Sem referência definida.' : cost !== null && cost > target ? 'Acima da referência.' : 'Dentro da referência.',
        interpretation: cost === null
          ? 'Não calculamos custo quando falta resultado mensurado.'
          : 'O custo é investimento dividido pelo resultado no estágio escolhido.',
        source: `Cálculo · ${sourceName(outcome.source)}`,
        confidence: `Confiança ${confidence}`,
        unavailable: cost === null,
      },
      {
        label: 'Receita e retorno',
        value: f.total.roi === null ? '—' : pct(f.total.roi, 0),
        comparison: f.total.revenue === null ? 'Indisponível · CRM não conectado' : `${brl(f.total.revenue)} de receita confirmada.`,
        reference: f.total.revenue === null ? 'Não calculamos retorno sem vendas confirmadas.' : 'Receita confirmada no CRM.',
        interpretation:
          f.total.revenue === null
            ? 'Contatos registrados não comprovam venda. O retorno só aparece com receita importada.'
            : 'Retorno calculado sobre a receita disponível no CRM.',
        source: 'CRM',
        confidence: f.total.revenue === null ? 'Confiança indisponível' : `Confiança ${confidence}`,
        unavailable: f.total.revenue === null,
      },
    ];
  }, [f, config.goal.goalStage, config.goal.targetCostPerGoal, readingConfidence.label, goalLabel, costDelta]);

  const flow = useMemo<FlowStage[]>(() => {
    if (!f) return [];
    const stages: FunnelStage[] = ['CLICK', 'INTERACTION', 'CONTACT', 'QUALIFIED', 'SALE'];
    const firstUnavailable = stages.findIndex((stage) => f.total.stages[stage].source === 'NONE');
    const hasOutage = outagesInPeriod.length > 0;
    return stages.map((stage, index) => {
      const data = f.total.stages[stage];
      const available = data.source !== 'NONE';
      return {
        label: STAGE_LABEL[stage],
        value: available ? num(data.count, 1) : '—',
        note: available
          ? stage === 'CLICK'
            ? `${brl(f.total.cost)} investidos`
            : 'Resultado registrado no período'
          : index === firstUnavailable
            ? 'A visão termina aqui'
            : 'Exige uma fonte anterior',
        source: sourceName(data.source),
        available,
        warning: hasOutage && stage === 'CONTACT',
      };
    });
  }, [f, outagesInPeriod.length]);

  /** Série diária para a leitura do histórico; sem conversão diária, não há custo exibido. */
  const evolution = useMemo<EChartsCoreOption | null>(() => {
    const window = account.window;
    const byDay = new Map<string, { cost: number; conversions: number }>();
    for (const row of ws.daily.value ?? []) {
      if (row.date < window.from || row.date > window.to) continue;
      const entry = byDay.get(row.date) ?? { cost: 0, conversions: 0 };
      entry.cost += row.cost;
      entry.conversions += row.conversions;
      byDay.set(row.date, entry);
    }
    const dates = [...byDay.keys()].sort();
    if (dates.length < 2) return null;
    const target = config.goal.targetCostPerGoal;
    const label = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
    const costPerConversion = dates.map((date) => {
      const day = byDay.get(date);
      return day && day.conversions > 0 ? Math.round((day.cost / day.conversions) * 100) / 100 : null;
    });
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number | string) => (typeof value === 'number' ? brl(value) : String(value)),
      },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
      grid: { left: 10, right: 10, top: 18, bottom: 36, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates.map(label) },
      yAxis: { type: 'value', min: 0, axisLabel: { formatter: (value: number) => brl(value).replace(',00', '') } },
      series: [
        {
          name: 'Custo por conversão registrada',
          type: 'line',
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2.5, color: '#1d1f21' },
          itemStyle: { color: '#1d1f21' },
          data: costPerConversion,
        },
        ...(target === null
          ? []
          : [
              {
                name: 'Referência',
                type: 'line' as const,
                showSymbol: false,
                lineStyle: { width: 1.5, type: 'dashed' as const, color: '#f2a60d' },
                itemStyle: { color: '#f2a60d' },
                data: dates.map(() => target),
              },
            ]),
      ],
    };
  }, [account.window, ws.daily.value, config.goal.targetCostPerGoal]);

  const decisionLabel = (r: RecommendationView) => DECISION_LABEL[r.category] ?? 'Investigar';
  const routeFor = (r: RecommendationView) => r.actionButton?.route ?? '/oportunidades';
  const evidenceText = (r: RecommendationView) =>
    r.evidence[0]?.text ?? 'A análise não trouxe uma evidência resumida para este item.';

  const ctr = (clicks: number, impressions: number) => (impressions > 0 ? pct(clicks / impressions, 2) : '—');
  const costPerClick = (cost: number, clicks: number) => (clicks > 0 ? brl(cost / clicks) : '—');

  return (
    <div>
      <header className="overview-heading" data-open-help="visao-geral-introducao">
        <div className="overview-eyebrow">Hoje · {account.rangeLabel}</div>
        <h1>O seu dinheiro está sendo bem usado?</h1>
        <p>Uma leitura para decidir o próximo passo, com a origem e os limites de cada número visíveis.</p>
      </header>

      <DataState loading={loadingCore} error={coreError} hasData={!!f} onRetry={ws.reloadAll}>
        {f && (
          <div className="overview-stack">
            <section
              aria-label="Veredito executivo"
              className={`overview-verdict ${
                verdict.tone === 'attention'
                  ? 'overview-verdict--attention'
                  : verdict.tone === 'risk'
                    ? 'overview-verdict--risk'
                    : verdict.tone === 'healthy'
                      ? 'overview-verdict--healthy'
                      : 'overview-verdict--neutral'
              }`}
            >
              <div className="overview-verdict__copy">
                <span className={`overview-state ${verdict.tone === 'healthy' ? 'overview-state--healthy' : ''}`}>
                  <Icon name={verdict.tone === 'healthy' ? 'check' : verdict.tone === 'neutral' ? 'info' : 'warning'} size="xs" />
                  {verdict.state}
                </span>
                <h2>{verdict.headline}</h2>
                <p>{verdict.reason}</p>
                <div className="overview-verdict__actions">
                  <Link to={verdict.route} className="btn btn-neutral btn-sm">
                    {verdict.action} <Icon name="arrow-right" size="xs" />
                  </Link>
                  <a href="#prioridades" className="btn btn-ghost btn-sm">
                    Ver evidências
                  </a>
                </div>
              </div>

              <dl className="overview-verdict__facts">
                {verdict.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                    <p>{fact.note}</p>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-label="Métricas essenciais" className="overview-kpis">
              {kpis.map((kpi) => (
                <article key={kpi.label} className={`overview-kpi ${kpi.unavailable ? 'overview-kpi--unavailable' : ''}`}>
                  <div className="overview-kpi__label">{kpi.label}</div>
                  <div className="overview-kpi__value">{kpi.value}</div>
                  <div className="overview-kpi__comparison">{kpi.comparison}</div>
                  <div className="overview-kpi__reference">{kpi.reference}</div>
                  <p>{kpi.interpretation}</p>
                  <footer>
                    <span className="overview-source">{kpi.source}</span>
                    <span className="overview-confidence">{kpi.confidence}</span>
                  </footer>
                </article>
              ))}
            </section>

            <section className="overview-flow" aria-labelledby="flow-title">
              <div className="overview-section-heading">
                <div>
                  <h2 id="flow-title">Fluxo do investimento</h2>
                  <p>Do dinheiro investido à venda: onde ele vira resultado e onde a visão termina.</p>
                </div>
                <div className="overview-legend" aria-label="Legenda do fluxo">
                  <span>
                    <i className="overview-legend__available"></i>Dado disponível
                  </span>
                  <span>
                    <i className="overview-legend__unavailable"></i>Indisponível
                  </span>
                  {outagesInPeriod.length > 0 && (
                    <span>
                      <i className="overview-legend__warning"></i>Medição em risco
                    </span>
                  )}
                </div>
              </div>

              <ol className="overview-flow__stages">
                {flow.map((stage) => (
                  <li key={stage.label} className={`${!stage.available ? 'is-unavailable' : ''} ${stage.warning ? 'is-warning' : ''}`}>
                    <div className="overview-flow__stage-label">{stage.label}</div>
                    <strong>{stage.value}</strong>
                    <span>{stage.note}</span>
                    <small>{stage.source}</small>
                  </li>
                ))}
              </ol>

              {!f.crmPresent && (
                <div className="overview-flow__limit">
                  <Icon name="info" size="sm" />
                  <p>
                    A visão termina em <strong>{goalLabel}</strong>. Para medir vendas, receita e retorno, importe os dados do CRM.
                  </p>
                  <Link to="/funil" className="btn btn-sm btn-outline">
                    Configurar CRM
                  </Link>
                </div>
              )}
            </section>

            <section id="prioridades" className="overview-priorities" data-open-help="visao-geral-prioridades">
              <div className="overview-section-heading">
                <div>
                  <h2>Decisões prioritárias</h2>
                  <p>Ordem por estado de decisão, dinheiro envolvido e confiança. Uma recomendação não altera a conta sozinha.</p>
                </div>
                <Link to="/oportunidades" className="btn btn-outline btn-sm">
                  Ver todas ({insights.openRecommendations.length})
                </Link>
              </div>

              <div className="overview-priority-list">
                {top.length > 0 ? (
                  top.map((r, position) => (
                    <article key={r.id} className="overview-priority">
                      <div className="overview-priority__number">{position + 1}</div>
                      <div className="overview-priority__body">
                        <div className="overview-priority__meta">
                          <span>{decisionLabel(r)}</span>
                          <ConfidenceBadge level={r.confidence.level} />
                        </div>
                        <h3>{r.title}</h3>
                        <p>{r.problem}</p>
                        <dl>
                          <div>
                            <dt>Evidência principal</dt>
                            <dd>{evidenceText(r)}</dd>
                          </div>
                          <div>
                            <dt>Como validar</dt>
                            <dd>{r.validation}</dd>
                          </div>
                        </dl>
                      </div>
                      <Link to={routeFor(r)} className="btn btn-neutral btn-sm overview-priority__action">
                        {r.actionButton?.label || 'Abrir análise'} <Icon name="arrow-right" size="xs" />
                      </Link>
                    </article>
                  ))
                ) : (
                  <div className="overview-empty-priority">
                    <Icon name="check" size="md" />
                    <div>
                      <h3>Nada exige ação agora</h3>
                      <p>Não há recomendações abertas com os dados disponíveis neste período.</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {evolution && (
              <section className="overview-evolution" aria-labelledby="evolution-title">
                <div className="overview-section-heading">
                  <div>
                    <h2 id="evolution-title">Como chegamos aqui?</h2>
                    <p>Custo por conversão registrada no Google Ads. A referência aparece apenas quando foi configurada.</p>
                  </div>
                </div>
                <EChart option={evolution} height={280} label="Evolução diária do custo por conversão registrada" />
                {outagesInPeriod.length > 0 && (
                  <p className="overview-chart-note">
                    <Icon name="warning" size="xs" /> Há períodos com conversões interrompidas; dias sem resultado não têm custo calculado.
                  </p>
                )}
              </section>
            )}

            <details className="overview-media-metrics">
              <summary>Ver métricas de mídia</summary>
              <div>
                <dl>
                  <div>
                    <dt>Impressões</dt>
                    <dd>{num(f.total.impressions)}</dd>
                  </div>
                  <div>
                    <dt>Cliques</dt>
                    <dd>{num(f.total.clicks)}</dd>
                  </div>
                  <div>
                    <dt>CTR</dt>
                    <dd>{ctr(f.total.clicks, f.total.impressions)}</dd>
                  </div>
                  <div>
                    <dt>CPC</dt>
                    <dd>{costPerClick(f.total.cost, f.total.clicks)}</dd>
                  </div>
                </dl>
                <p>
                  Indicadores de apoio do Google Ads. Eles ajudam a investigar, mas não substituem custo por resultado, qualidade e receita.
                </p>
              </div>
            </details>
          </div>
        )}
      </DataState>
    </div>
  );
}
