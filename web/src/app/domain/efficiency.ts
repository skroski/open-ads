import { DateWindow } from './dates';
import { brl, num, pct } from './format';
import {
  BusinessGoal,
  ChannelType,
  ConversionActionInfo,
  ConversionMapping,
  Evidence,
  STAGE_LABEL,
  WasteDimension,
  WasteRow,
} from './models';
import { costReference } from './waste';
import {
  WasteEnv,
  WasteInputs,
  wasteAds,
  wasteCampaigns,
  wasteDevices,
  wasteHours,
  wasteKeywords,
  wastePages,
  wastePlacements,
  wasteRegions,
  wasteTerms,
} from './waste-dimensions';

export type MediaScope = ChannelType | 'ALL';
export type EfficiencyRows = Record<WasteDimension, WasteRow[]>;

/** metrics.conversions não pode ser renomeado para contatos se mistura etapas. */
export function aggregateMatchesGoal(
  actions: readonly ConversionActionInfo[],
  mapping: ConversionMapping,
  goal: BusinessGoal,
): boolean {
  const counted = actions.filter(
    (a) => a.status === 'ENABLED' && a.primary && a.includeInConversions,
  );
  return counted.length > 0 && counted.every((a) => mapping[a.name] === goal.goalStage);
}

/** Mantém somente recortes que podem ser ligados à campanha, sem ratear totais. */
export function scopeWasteInputs(
  input: WasteInputs,
  channel: MediaScope,
  campaignId = '',
): WasteInputs {
  if (channel === 'ALL' && !campaignId) return input;
  const campaigns = (input.campaigns ?? []).filter(
    (c) => (channel === 'ALL' || c.channel === channel) && (!campaignId || c.id === campaignId),
  );
  const ids = new Set(campaigns.map((c) => c.id));
  const belongs = (r: { campaignId: string }): boolean => ids.has(r.campaignId);
  return {
    ...input,
    campaigns,
    terms: input.terms.filter(belongs),
    keywords: input.keywords.filter(belongs),
    ads: input.ads?.filter(belongs),
    placements: input.placements?.filter(belongs),
    landingPages: input.landingPages?.filter(belongs),
    hours: input.hours?.filter(belongs),
    // As consultas atuais destes recortes trazem a conta inteira.
    regions: undefined,
    devices: undefined,
    adsByGroup: new Map(
      [...input.adsByGroup].filter(([id]) =>
        input.ads?.some((a) => a.adGroupId === id && belongs(a)),
      ),
    ),
  };
}

export function analyzeEfficiency(
  input: WasteInputs,
  env: WasteEnv,
  channel: MediaScope,
  campaignId = '',
): EfficiencyRows {
  const scoped = scopeWasteInputs(input, channel, campaignId);
  const cost = (scoped.campaigns ?? []).reduce((s, c) => s + c.cost, 0);
  const metrics = (scoped.campaigns ?? []).map((c) => scoped.funnel?.byCampaign.get(c.id));
  const known = metrics.every((m) => !!m && env.outcomesOf(m) !== null);
  const sources = new Set(metrics.map((m) => m?.stages[env.context.goal.goalStage].source));
  const outcomes = known && sources.size === 1 ? metrics.reduce((s, m) => s + (m ? (env.outcomesOf(m) ?? 0) : 0), 0) : 0;
  const reference = costReference(env.context.goal, cost, outcomes);
  const scopedEnv: WasteEnv = {
    ...env,
    options: (dimension, label, extra) => ({
      ...env.options(dimension, label, extra),
      // A média de formatos diferentes não é uma meta de CPA comparável.
      costTarget: reference.isAverage && (channel === 'ALL' || (dimension === 'campaign' && metrics.length < 2)) ? null : reference.target,
      costTargetIsAverage: reference.isAverage,
      costReferenceLabel: 'a média das campanhas deste formato no recorte selecionado',
      allowGroupFallback: false,
    }),
  };
  return {
    campaign: wasteCampaigns(scoped, scopedEnv),
    placement: wastePlacements(scoped, scopedEnv),
    ad: wasteAds(scoped, scopedEnv),
    page: wastePages(scoped, scopedEnv),
    term: wasteTerms(scoped, scopedEnv),
    keyword: wasteKeywords(scoped, scopedEnv),
    hour: wasteHours(scoped, scopedEnv),
    device: wasteDevices(scoped, scopedEnv),
    region: wasteRegions(scoped, scopedEnv),
  };
}

export interface EfficiencyAdvice {
  row: WasteRow;
  priority: number;
  priorityLabel: string;
  headline: string;
  explanation: string;
  action: string;
  validation: string;
  facts: Evidence[];
  hypotheses: Evidence[];
  missing: Evidence[];
  impact: { amount: number | null; label: string; basis: string };
}

const ACTION: Record<WasteDimension, string> = {
  campaign:
    'Revise os recortes desta campanha e teste uma mudança de cada vez na segmentação, no criativo ou na página.',
  placement:
    'Confira o site, aplicativo ou canal e os contatos atribuídos a ele. Se a inadequação for confirmada, teste a exclusão no Google Ads e acompanhe as conversões valiosas.',
  ad: 'Compare a promessa do anúncio com a página e teste um criativo com benefício, oferta e chamada mais claros.',
  page: 'Teste a página no celular, o carregamento e o caminho até o contato. Confira se ela entrega o que o anúncio promete.',
  term: 'Revise a intenção da busca, a correspondência e as negativas. Antes de negativar, confira os contatos que a busca trouxe.',
  keyword:
    'Revise os termos acionados, a correspondência e a relação entre palavra, anúncio e página antes de alterar lances.',
  region:
    'Confira presença e interesse geográfico e a área realmente atendida antes de mudar a segmentação.',
  device: 'Teste a experiência e a conversão em cada dispositivo antes de mudar lances.',
  hour: 'Confira horário de atendimento e prazo de resposta. Compare resultados após a janela de conversão antes de restringir horários.',
};

/** Orientação auditável; gasto observado nunca vira promessa de economia. */
export function efficiencyAdvice(
  row: WasteRow,
  goal: BusinessGoal,
  window: DateWindow,
): EfficiencyAdvice {
  const a = row.assessment;
  const stage = STAGE_LABEL[goal.goalStage].toLowerCase();
  const known = row.outcomesKnown !== false;
  let headline = 'Acompanhar antes de mudar';
  let explanation =
    'Os dados ainda não sustentam uma conclusão sobre a qualidade deste público ou item.';
  let action = ACTION[row.dimension];
  let priority = 3;
  let priorityLabel = 'Reunir mais dados';
  if (a.verdict === 'TRACKING_FAILURE') {
    headline = 'Confira a medição primeiro';
    explanation =
      'Há indícios de problema na medição ou na página. Isso pode esconder resultados e fazer um investimento útil parecer desperdício.';
    action =
      'Teste o formulário e os botões de contato, confira as etiquetas e compare os registros no Google Ads, Analytics e atendimento.';
    priority = 0;
    priorityLabel = 'Verificar primeiro';
  } else if (a.verdict === 'PROBABLE_WASTE') {
    headline = 'Há sinais de gasto que merece revisão';
    explanation =
      'Os dados e os sinais observados justificam uma revisão. Eles não provam que todo o público é inadequado nem que cortar a verba preservará todos os resultados.';
    priority = 1;
    priorityLabel = 'Revisar com prioridade';
  } else if (a.verdict === 'ABOVE_TARGET') {
    headline = 'O resultado está custando mais que a referência';
    explanation = `Há resultados, mas o custo por ${stage} está acima da referência usada nesta análise. Confira a qualidade deles antes de reduzir o investimento.`;
    priority = a.confidence.level === 'LOW' ? 3 : 2;
    priorityLabel =
      a.confidence.level === 'LOW' ? 'Confirmar com mais resultados' : 'Testar uma melhoria';
  } else if (a.verdict === 'PERFORMING') {
    headline = 'Preserve o que está trazendo resultado';
    explanation = `O custo por ${stage} está dentro da referência nesta janela. Isso não comprova lucro nem garante o mesmo custo ao aumentar a verba.`;
    action =
      'Mantenha como referência e acompanhe a qualidade dos resultados antes de ampliar o orçamento.';
    priority = 4;
    priorityLabel = 'Preservar e acompanhar';
  } else if (a.reason === 'IMMATURE') {
    explanation =
      'Parte dos cliques ainda pode virar resultado dentro do prazo normal. Cortar agora pode interromper conversões valiosas.';
    action =
      'Aguarde a janela de conversão ou selecione um período anterior já completo. Depois refaça a análise.';
  } else if (a.reason === 'LOW_VOLUME') {
    action =
      'Acumule mais cliques e resultados comparáveis. Confira a medição e evite excluir públicos com base em poucos casos.';
  } else if (a.reason === 'NO_GOAL_DATA') {
    action =
      'Confirme o significado das conversões no funil e vincule contatos qualificados ou vendas à campanha. Resultado desconhecido não significa zero.';
  } else if (a.reason === 'NO_CONFIG') {
    action = 'Defina o resultado que importa e o custo aceitável por ele nas Configurações.';
  }
  if (row.blocked) {
    headline = 'Este item já foi bloqueado';
    priority = 5;
    priorityLabel = 'Acompanhar a mudança';
    action =
      'Acompanhe os resultados após o bloqueio. Este é um gasto passado; não há nova exclusão a fazer.';
  }
  const facts = a.evidence.filter((e) => e.kind === 'FACT');
  const hypotheses = a.evidence.filter((e) => e.kind === 'HYPOTHESIS');
  const missing = a.evidence.filter((e) => e.kind === 'UNAVAILABLE');
  if (goal.goalStage === 'CONTACT' || goal.goalStage === 'INTERACTION') {
    missing.push({
      kind: 'UNAVAILABLE',
      source: 'CRM',
      text: 'A contagem de interações ou contatos não informa quantos têm perfil para comprar. Confira qualificação e vendas no atendimento.',
    });
  }
  if (row.dimension === 'placement' && hypotheses.length === 0) {
    hypotheses.push({
      kind: 'HYPOTHESIS',
      source: 'CALCULATION',
      text: 'O contexto do posicionamento, a promessa do anúncio ou a página podem explicar cliques sem resultado. É preciso verificar cada possibilidade.',
    });
  }
  const target = goal.targetCostPerGoal;
  // Cenário histórico, nunca estimativa causal de economia futura.
  const canCompare =
    a.verdict === 'ABOVE_TARGET' &&
    a.confidence.level === 'HIGH' &&
    known &&
    row.outcomes >= 10 &&
    target !== null &&
    target > 0 &&
    !row.blocked;
  const amount = canCompare ? Math.max(0, row.perf.cost - row.outcomes * target!) : null;
  return {
    row,
    priority,
    priorityLabel,
    headline,
    explanation,
    action,
    facts,
    hypotheses,
    missing,
    validation: `Após a mudança, aguarde a janela de conversão e compare custo por ${stage}, volume e qualidade no mesmo modelo de atribuição.`,
    impact: {
      amount,
      label:
        amount !== null
          ? 'Diferença para a meta neste período'
          : 'Impacto financeiro ainda não estimado',
      basis:
        amount !== null
          ? `${brl(row.perf.cost)} de gasto − ${num(row.outcomes, 1)} resultados × ${brl(target!)} de meta. Cenário para ${window.from} a ${window.to}, supondo os mesmos resultados na meta; não é economia garantida.`
          : `O gasto observado foi ${brl(row.perf.cost)}. Faltam dados para estimar quanto uma mudança economizaria sem perder resultados valiosos.`,
    },
  };
}

export function placementCoverage(cost: number, campaignCost: number): string {
  if (campaignCost <= 0) return 'Sem investimento para comparar.';
  return `${pct(cost / campaignCost, 0)} do gasto em campanhas aparece neste relatório de posicionamentos. Os recortes se sobrepõem e não devem ser somados.`;
}
