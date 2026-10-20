import { ContentOpportunity } from './content';
import { brl, days, num, pct, plural } from './format';
import { FunnelResult } from './funnel';
import { PageRecommendation, TermCluster } from './intent';
import {
  BusinessGoal,
  CampaignRow,
  Confidence,
  Evidence,
  Recommendation,
  RecommendationCategory,
  SearchTermRow,
  SourceStatus,
  STAGE_LABEL,
  Thresholds,
  WasteRow,
} from './models';
import { OutageFinding } from './tracking';

export interface PageFinding {
  cluster: TermCluster;
  currentUrls: string[];
  recommendation: PageRecommendation;
  /** Coerência média (0–1) das buscas do grupo; null quando não mensurável. */
  coherence: number | null;
}

export interface CrmQuality {
  leads: number;
  disqualified: number;
  disqualifiedShare: number;
  medianResponseMinutes: number | null;
  slowResponseShare: number | null;
}

export interface RecommendationInput {
  windowDays: number;
  windowLabel: string;
  goal: BusinessGoal;
  thresholds: Thresholds;
  /** Fração do período que já teve tempo de gerar o estágio-meta. */
  maturity: number;
  maturesOn: string;
  funnel: FunnelResult;
  campaigns: readonly CampaignRow[];
  waste: {
    campaigns: readonly WasteRow[];
    terms: readonly WasteRow[];
    regions: readonly WasteRow[];
    hours: readonly WasteRow[];
    pages: readonly WasteRow[];
    placements: readonly WasteRow[];
  };
  terms: readonly SearchTermRow[];
  outages: readonly OutageFinding[];
  pageFindings: readonly PageFinding[];
  contentOpportunities: readonly ContentOpportunity[];
  crmQuality: CrmQuality | null;
  sources: { crm: boolean; ga4: SourceStatus; searchConsole: SourceStatus };
  serviceAreaConfigured: boolean;
  /** Parcela do custo de Pesquisa explicada pelos termos visíveis (0–1). */
  searchCoverage: number | null;
}

const BASE_PRIORITY: Record<RecommendationCategory, number> = {
  TRACKING: 80,
  WASTE: 45,
  CAMPAIGN: 40,
  FUNNEL: 35,
  LANDING_PAGE: 35,
  DATA_QUALITY: 30,
  CONTENT: 25,
};

const CONFIDENCE_WEIGHT: Record<Confidence['level'], number> = { HIGH: 1, MEDIUM: 0.75, LOW: 0.5 };

function priority(category: RecommendationCategory, monthlyCost: number | undefined, c: Confidence): number {
  const money = Math.min(35, (monthlyCost ?? 0) / 8);
  return Math.round(Math.min(100, (BASE_PRIORITY[category] + money) * CONFIDENCE_WEIGHT[c.level]));
}

function fact(text: string, source: Evidence['source'] = 'GOOGLE_ADS'): Evidence {
  return { kind: 'FACT', text, source };
}
function hypothesis(text: string, source: Evidence['source'] = 'CALCULATION'): Evidence {
  return { kind: 'HYPOTHESIS', text, source };
}
function missing(text: string, source: Evidence['source'] = 'CALCULATION'): Evidence {
  return { kind: 'UNAVAILABLE', text, source };
}

function lowestConfidence(rows: readonly WasteRow[]): Confidence {
  const order: Record<Confidence['level'], number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };
  const sum = rows.reduce((s, r) => s + order[r.assessment.confidence.level] * r.perf.cost, 0);
  const cost = rows.reduce((s, r) => s + r.perf.cost, 0);
  const avg = cost > 0 ? sum / cost : 0;
  const level = avg >= 1.6 ? 'HIGH' : avg >= 0.8 ? 'MEDIUM' : 'LOW';
  return { level, reasons: ['Combina a confiança de cada item, ponderada pelo custo.'] };
}

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const out: Recommendation[] = [];
  const stage = STAGE_LABEL[input.goal.goalStage].toLowerCase();
  const push = (r: Omit<Recommendation, 'priority'> & { priority?: number }): void => {
    // Os valores mensais antigos são exposição ao gasto, não estimativas causais
    // de economia. Recortes sobrepostos também não podem ser somados no plano.
    const impact = r.impact.monthlyCostBrl === undefined ? r.impact : {
      description: 'Impacto financeiro ainda não estimado. O gasto observado nas evidências indica o que revisar, sem garantir economia ou preservar todas as conversões.',
      basis: `${r.impact.basis} A hipótese de melhoria ainda precisa ser validada. Mensalizar o gasto não estima o efeito de uma mudança; valide volume, janela, atribuição e qualidade dos resultados antes de projetar ganhos.`,
    };
    out.push({
      ...r,
      impact,
      priority: r.priority ?? priority(r.category, r.impact.monthlyCostBrl, r.confidence),
    });
  };

  // ───── Rastreamento ─────
  for (const o of input.outages.slice(0, 3)) {
    const where = o.scope === 'ACCOUNT' ? 'na conta' : `na campanha "${o.campaignName}"`;
    push({
      id: `tracking:outage:${o.scope}:${o.campaignId ?? 'conta'}:${o.from}`,
      category: 'TRACKING',
      title: o.ongoing ? `Conversões pararam ${where}` : `Período sem conversões ${where}`,
      problem: `Houve ${plural(o.days, 'dia', 'dias')} seguidos (${o.from} a ${o.to}) com ${num(o.clicks)} cliques e nenhuma conversão registrada${
        o.ongoing ? ', e a sequência continua até o último dia com dados' : ''
      }.`,
      evidence: [
        fact(`${num(o.clicks)} cliques e ${brl(o.cost)} gastos sem nenhuma conversão registrada.`),
        fact(`O restante do período converte ${pct(o.baselineRate, 1)} dos cliques.`, 'CALCULATION'),
        fact(`A chance de isso acontecer só por acaso é de ${pct(o.chanceByLuck, 2)}.`, 'CALCULATION'),
        hypothesis(
          o.ongoing
            ? 'A tag de conversão, o formulário ou o botão de contato pode ter parado de registrar.'
            : 'Ou a medição falhou nesse trecho, ou ainda não existia (ação de conversão criada depois): nos dois casos esse gasto não pode ser avaliado.',
        ),
        missing('Sem o Google Analytics conectado, não dá para confirmar se as visitas continuam chegando.', 'GA4'),
      ],
      impact: o.ongoing
        ? {
            monthlyCostBrl: (o.cost / o.days) * 30,
            description: `Enquanto a medição estiver falhando, cerca de ${brl((o.cost / o.days) * 30)} por mês são investidos sem como medir resultado.`,
            basis: 'Gasto diário médio do trecho sem conversões, projetado para 30 dias.',
          }
        : {
            description: `Nesse trecho foram investidos ${brl(o.cost)} sem como medir resultado.`,
            basis: 'Custo real do período sem conversões; não é projetado para o futuro.',
          },
      action: o.ongoing
        ? 'Teste o formulário e o botão de contato no site e confira a tag de conversão (Tag Assistant). Corrija antes de otimizar qualquer outra coisa.'
        : 'Confira quando a ação de conversão foi criada. Não use este trecho para comparar campanhas: ele não tem como medir resultado.',
      actionButton: { label: 'Ver histórico de mudanças', kind: 'ROUTE', route: '/historico' },
      confidence: {
        level: o.chanceByLuck < 0.001 ? 'HIGH' : 'MEDIUM',
        reasons: ['Sequência improvável de acontecer por acaso.'],
      },
      validation: o.ongoing
        ? 'Depois da correção, as conversões voltam a aparecer em 1 a 2 dias.'
        : 'As conversões aparecem normalmente nos dias seguintes ao trecho; basta excluir este intervalo das comparações.',
      entity: { type: o.scope === 'ACCOUNT' ? 'account' : 'campaign', id: o.campaignId ?? 'conta', label: o.campaignName ?? 'Conta' },
      // Falha já encerrada é informação para não comparar esse trecho; só a que continua é urgente.
      priority: o.ongoing ? undefined : 45,
    });
  }

  for (const row of input.waste.pages.filter((r) => r.assessment.verdict === 'TRACKING_FAILURE').slice(0, 3)) {
    push({
      id: `tracking:page:${row.key}`,
      category: 'TRACKING',
      title: `Possível problema de medição em ${row.label}`,
      problem: `A página recebeu ${num(row.perf.clicks)} cliques pagos, mas há indícios de que a medição ou a própria página falham.`,
      evidence: row.assessment.evidence,
      impact: {
        monthlyCostBrl: row.monthlyCost,
        description: `${brl(row.monthlyCost)} por mês levam a uma página que pode não estar medindo ou entregando o que deveria.`,
        basis: 'Custo do período mensalizado.',
      },
      action: 'Abra a página em um celular e em um computador, confira a tag de medição e o botão de contato.',
      actionButton: { label: 'Ver intenção e páginas', kind: 'ROUTE', route: '/intencao' },
      confidence: row.assessment.confidence,
      validation: 'A página passa a registrar sessões e conversões no Analytics e no Google Ads.',
      entity: { type: 'page', id: row.key, label: row.label },
    });
  }

  // ───── Desperdício em termos ─────
  // Termos já bloqueados contam como desperdício na tela, mas não há o que negativar.
  const probableTerms = input.waste.terms
    .filter((r) => r.assessment.verdict === 'PROBABLE_WASTE' && !r.blocked)
    .sort((a, b) => b.perf.cost - a.perf.cost);
  const alreadyListed = new Set(probableTerms.map((r) => r.key.split('|')[0]));

  if (probableTerms.length) {
    const top = probableTerms.slice(0, 25);
    const cost = probableTerms.reduce((s, r) => s + r.perf.cost, 0);
    const monthlyCost = probableTerms.reduce((s, r) => s + r.monthlyCost, 0);
    const conf = lowestConfidence(probableTerms);
    push({
      id: 'waste:terms:probable',
      category: 'WASTE',
      title: `${plural(probableTerms.length, 'termo', 'termos')} com desperdício provável`,
      problem: `${plural(probableTerms.length, 'busca consumiu', 'buscas consumiram')} ${brl(cost)} sem nenhum resultado, em volume que não se explica por acaso, e com outro sinal apontando para falta de intenção de compra.`,
      evidence: [
        fact(`${brl(cost)} em ${num(probableTerms.reduce((s, r) => s + r.perf.clicks, 0))} cliques sem ${stage}.`),
        fact(`Maiores gastos: ${top.slice(0, 5).map((r) => `"${r.label}" (${brl(r.perf.cost)})`).join(', ')}.`),
        hypothesis('Negativar esses termos não deve reduzir contatos, porque eles não geraram nenhum no período.'),
        ...(input.maturity < 1
          ? [fact(`Só ${pct(input.maturity, 0)} do período já teve tempo de gerar ${stage}.`, 'CONFIG')]
          : []),
      ],
      impact: {
        monthlyCostBrl: monthlyCost,
        description: `Até ${brl(monthlyCost)} por mês deixariam de ser gastos em buscas sem resultado.`,
        basis: 'Custo do período projetado para 30 dias, supondo que o padrão se mantenha.',
      },
      action: `Negativar os ${plural(top.length, 'termo', 'termos')} listados (correspondência exata) e acompanhar o custo por ${stage} nas duas semanas seguintes.`,
      actionButton: { label: `Negativar ${top.length}`, kind: 'NEGATE_TERMS', terms: top.map((r) => r.label) },
      confidence: conf,
      validation: `O custo por ${stage} da campanha cai e o número de ${stage} se mantém. O histórico mostra o efeito depois de 7 a 14 dias.`,
    });
  }

  const unqualified = input.terms
    .filter((t) => t.category === 'UNQUALIFIED' && !t.alreadyNegative && t.cost > 0 && !alreadyListed.has(t.term))
    .sort((a, b) => b.cost - a.cost);
  if (unqualified.length) {
    const cost = unqualified.reduce((s, t) => s + t.cost, 0);
    const monthlyCost = (cost / Math.max(1, input.windowDays)) * 30;
    const withResults = unqualified.filter((t) => t.conversions > 0);
    push({
      id: 'waste:terms:unqualified',
      category: 'WASTE',
      title: `${plural(unqualified.length, 'busca', 'buscas')} da sua lista de "sem intenção de compra" ${
        unqualified.length === 1 ? 'ainda ativa' : 'ainda ativas'
      }`,
      problem: `Termos como ${unqualified
        .slice(0, 3)
        .map((t) => `"${t.term}"`)
        .join(', ')} correspondem à lista que você marcou como sem intenção de compra e ainda não estão bloqueados.`,
      evidence: [
        fact(`${brl(cost)} gastos nesses termos no período.`),
        fact(`Correspondem às regras de desqualificação da conta (ex.: ${unqualified[0].categoryReason}).`, 'CONFIG'),
        ...(withResults.length
          ? [
              fact(
                `Atenção: ${plural(withResults.length, 'termo gerou', 'termos geraram')} conversão. Confira antes de negativar.`,
              ),
            ]
          : []),
        hypothesis('Quem busca assim tende a não contratar; a lista de regras é uma aproximação.'),
      ],
      impact: {
        monthlyCostBrl: monthlyCost,
        description: `Cerca de ${brl(monthlyCost)} por mês em buscas de baixa intenção.`,
        basis: 'Custo do período mensalizado. Parte pode converter; veja a coluna de conversões.',
      },
      action: 'Revisar a lista e negativar os termos que realmente não interessam.',
      actionButton: {
        label: 'Revisar e negativar',
        kind: 'NEGATE_TERMS',
        terms: unqualified.filter((t) => t.conversions === 0).slice(0, 40).map((t) => t.term),
      },
      confidence: {
        level: withResults.length ? 'LOW' : 'MEDIUM',
        reasons: ['Baseado em uma lista de palavras, não em resultado medido.'],
      },
      validation: 'Os termos negativados deixam de aparecer no relatório de termos de pesquisa.',
    });
  }

  // ───── Regiões fora da área ─────
  const outOfArea = input.waste.regions.filter((r) => r.assessment.verdict === 'PROBABLE_WASTE');
  if (outOfArea.length) {
    const cost = outOfArea.reduce((s, r) => s + r.perf.cost, 0);
    const monthlyCost = outOfArea.reduce((s, r) => s + r.monthlyCost, 0);
    push({
      id: 'waste:regions:out-of-area',
      category: 'WASTE',
      title: `Cliques em ${plural(outOfArea.length, 'região', 'regiões')} fora da área atendida`,
      problem: `${brl(cost)} foram gastos em ${outOfArea.map((r) => r.label).join(', ')}, onde a empresa não atende.`,
      evidence: [
        fact(`Área de atendimento configurada exclui ${outOfArea.map((r) => r.label).join(', ')}.`, 'CONFIG'),
        fact(`${num(outOfArea.reduce((s, r) => s + r.perf.clicks, 0))} cliques e ${brl(cost)} nessas regiões.`),
        hypothesis('Contatos vindos dessas regiões provavelmente não podem ser atendidos.'),
      ],
      impact: {
        monthlyCostBrl: monthlyCost,
        description: `Cerca de ${brl(monthlyCost)} por mês em regiões sem atendimento.`,
        basis: 'Custo do período mensalizado.',
      },
      action: 'Excluir essas regiões da segmentação (ou reduzir o lance por local) nas campanhas afetadas, no Google Ads.',
      actionButton: { label: 'Ver regiões', kind: 'ROUTE', route: '/desperdicios', queryParams: { dim: 'region' } },
      confidence: { level: 'HIGH', reasons: ['Baseado na área de atendimento que você configurou.'] },
      validation: 'Nas semanas seguintes, o relatório de regiões não deve mais mostrar custo nelas.',
    });
  } else if (!input.serviceAreaConfigured) {
    push({
      id: 'data:service-area',
      category: 'DATA_QUALITY',
      title: 'Defina em quais regiões a empresa atende',
      problem: 'Sem a área de atendimento, não dá para saber se parte do investimento chega a regiões que a empresa não cobre.',
      evidence: [missing('Área de atendimento não configurada.', 'CONFIG')],
      impact: {
        description: 'Permite identificar gasto em regiões sem atendimento.',
        basis: 'Depende de você informar as regiões.',
      },
      action: 'Em Configurações, marque as regiões atendidas.',
      actionButton: { label: 'Configurar', kind: 'ROUTE', route: '/configuracoes' },
      confidence: { level: 'HIGH', reasons: ['A informação não existe nos dados atuais.'] },
      validation: 'A tela de desperdícios passa a classificar as regiões.',
    });
  }

  // ───── Display: posicionamentos ─────
  const badPlacements = input.waste.placements.filter((r) => r.assessment.verdict === 'PROBABLE_WASTE');
  if (badPlacements.length) {
    const cost = badPlacements.reduce((s, r) => s + r.perf.cost, 0);
    const monthlyCost = badPlacements.reduce((s, r) => s + r.monthlyCost, 0);
    push({
      id: 'waste:placements',
      category: 'WASTE',
      title: `${plural(badPlacements.length, 'posicionamento', 'posicionamentos')} do Display sem resultado`,
      problem: `Os anúncios apareceram em ${plural(badPlacements.length, 'local', 'locais')} (como aplicativos e sites) que gastaram ${brl(cost)} sem nenhum resultado.`,
      evidence: [
        fact(
          `Maiores gastos: ${badPlacements
            .slice(0, 4)
            .map((r) => `${r.label} (${brl(r.perf.cost)})`)
            .join('; ')}.`,
        ),
        hypothesis('O contexto do posicionamento, o criativo ou a página podem explicar cliques sem resultado. O tipo de aplicativo, sozinho, não identifica público inadequado.'),
      ],
      impact: {
        monthlyCostBrl: monthlyCost,
        description: `Cerca de ${brl(monthlyCost)} por mês em locais sem resultado.`,
        basis: 'Custo do período mensalizado.',
      },
      action: 'No Google Ads, adicionar esses locais às exclusões de posicionamento da campanha de Display.',
      actionButton: { label: 'Ver posicionamentos', kind: 'ROUTE', route: '/desperdicios', queryParams: { dim: 'placement' } },
      confidence: lowestConfidence(badPlacements),
      validation: 'Os locais excluídos deixam de aparecer no relatório de posicionamentos.',
    });
  }

  // ───── Campanhas ─────
  const above = input.waste.campaigns
    .filter((r) => r.assessment.verdict === 'ABOVE_TARGET')
    .sort((a, b) => b.perf.cost - a.perf.cost);
  const performing = input.waste.campaigns
    .filter((r) => r.assessment.verdict === 'PERFORMING' && r.outcomes > 0)
    .sort((a, b) => a.perf.cost / a.outcomes - b.perf.cost / b.outcomes);

  for (const row of above.slice(0, 3)) {
    const cpo = row.perf.cost / Math.max(row.outcomes, 1);
    const channel = input.campaigns.find((c) => c.id === row.key)?.channel;
    const best = channel ? performing.find((r) => input.campaigns.find((c) => c.id === r.key)?.channel === channel) : undefined;
    const bestCpo = best ? best.perf.cost / best.outcomes : null;
    push({
      id: `campaign:above:${row.key}`,
      category: 'CAMPAIGN',
      title: `"${row.label}" custa mais por ${stage} do que o esperado`,
      problem: `A campanha entrega ${stage} a ${brl(cpo)} cada, bem acima da referência.`,
      evidence: [
        ...row.assessment.evidence,
        ...(best && bestCpo !== null
          ? [fact(`"${best.label}" entrega a ${brl(bestCpo)} por ${stage} no mesmo período.`)]
          : []),
        hypothesis('O custo marginal de uma campanha melhor tende a subir quando recebe mais verba; a economia real pode ser menor.'),
      ],
      impact: {
        monthlyCostBrl: row.monthlyCost,
        description:
          best && bestCpo !== null
            ? `Mover parte dos ${brl(row.monthlyCost)} mensais para "${best.label}" pode render mais ${stage} pelo mesmo investimento.`
            : `${brl(row.monthlyCost)} por mês estão em uma campanha acima da referência.`,
        basis: 'Supõe que o custo por resultado médio se mantém ao mover verba: é uma estimativa otimista.',
      },
      action: best && row.assessment.confidence.level !== 'LOW'
        ? `Revisar "${row.label}" e testar uma pequena realocação para "${best.label}", acompanhando volume e qualidade antes de ampliar a mudança.`
        : `Revisar segmentação, termos e página de "${row.label}".`,
      actionButton: { label: 'Ver campanhas', kind: 'ROUTE', route: '/campanhas' },
      confidence: row.assessment.confidence,
      validation: `O custo médio por ${stage} da conta cai sem queda proporcional no total de ${stage}.`,
      entity: { type: 'campaign', id: row.key, label: row.label },
    });
  }

  for (const c of input.campaigns.filter((x) => x.status === 'PAUSED')) {
    const row = performing.find((r) => r.key === c.id);
    if (!row) continue;
    const cpo = row.perf.cost / row.outcomes;
    push({
      id: `campaign:paused-performing:${c.id}`,
      category: 'CAMPAIGN',
      title: `"${c.name}" está pausada e entregava bem`,
      problem: `A campanha entregou ${num(row.outcomes, 1)} ${stage} a ${brl(cpo)} cada no período e hoje está pausada.`,
      evidence: [
        fact(`Status atual: pausada.`),
        fact(`${num(row.outcomes, 1)} ${stage} por ${brl(row.perf.cost)} no período.`),
        hypothesis('A pausa pode ser intencional (orçamento, teste ou mudança de estratégia).'),
        missing('O motivo da pausa não está nos dados. Veja o histórico de mudanças para saber quem e quando pausou.', 'GOOGLE_ADS'),
      ],
      impact: {
        description: 'Pode estar deixando de captar contatos baratos.',
        basis: 'Baseado no desempenho recente da própria campanha; não considera mudanças de mercado.',
      },
      action: 'Confirmar se a pausa foi intencional. Se não foi, reativar com orçamento controlado e acompanhar.',
      actionButton: { label: 'Ver histórico', kind: 'ROUTE', route: '/historico' },
      confidence: { level: 'MEDIUM', reasons: ['Desempenho medido, mas o motivo da pausa é desconhecido.'] },
      validation: 'Depois de reativada, o custo por resultado se mantém perto do observado antes da pausa.',
      entity: { type: 'campaign', id: c.id, label: c.name },
    });
  }

  // ───── Horário ─────
  const afterHours = input.waste.hours.filter((r) => r.key.startsWith('h:') && r.assessment.verdict === 'PROBABLE_WASTE');
  if (afterHours.length) {
    const cost = afterHours.reduce((s, r) => s + r.perf.cost, 0);
    const monthlyCost = afterHours.reduce((s, r) => s + r.monthlyCost, 0);
    push({
      id: 'waste:hours',
      category: 'WASTE',
      title: 'Cliques fora do horário de atendimento sem resultado',
      problem: `${brl(cost)} foram gastos em horários em que ninguém atende, sem nenhum resultado.`,
      evidence: [
        fact(`Horários: ${afterHours.slice(0, 6).map((r) => r.label).join(', ')}.`),
        hypothesis('Contatos fora do horário tendem a esfriar sem resposta rápida.'),
      ],
      impact: {
        monthlyCostBrl: monthlyCost,
        description: `Cerca de ${brl(monthlyCost)} por mês.`,
        basis: 'Custo do período mensalizado.',
      },
      action: 'Aplicar programação de anúncios (dias e horas) ou reduzir lances fora do horário de atendimento.',
      actionButton: { label: 'Ver horários', kind: 'ROUTE', route: '/desperdicios', queryParams: { dim: 'hour' } },
      confidence: lowestConfidence(afterHours),
      validation: 'O custo fora do horário cai e o número de contatos atendidos se mantém.',
    });
  }

  // ───── Atendimento (CRM) ─────
  if (input.crmQuality && input.crmQuality.leads >= 10) {
    const q = input.crmQuality;
    if (q.disqualifiedShare >= 0.3) {
      push({
        id: 'funnel:disqualified',
        category: 'FUNNEL',
        title: 'Muitos contatos chegam sem perfil',
        problem: `${pct(q.disqualifiedShare, 0)} dos contatos foram desqualificados pelo atendimento.`,
        evidence: [
          fact(`${num(q.disqualified)} de ${num(q.leads)} contatos desqualificados.`, 'CRM'),
          hypothesis('A mensagem do anúncio ou da página pode estar atraindo quem não é o público.'),
        ],
        impact: {
          description: 'Reduz o custo por lead qualificado ao filtrar melhor quem chega.',
          basis: 'Depende de ajustar mensagem, termos e páginas.',
        },
        action: 'Deixar claro na página e nos anúncios para quem é o produto (e quanto custa), e negativar termos de quem não tem perfil.',
        actionButton: { label: 'Ver qualidade do funil', kind: 'ROUTE', route: '/funil' },
        confidence: { level: q.leads >= 30 ? 'HIGH' : 'MEDIUM', reasons: [`${num(q.leads)} leads no CRM.`] },
        validation: 'A parcela de desqualificados cai nas próximas semanas.',
      });
    }
    if (q.medianResponseMinutes !== null && q.medianResponseMinutes > 60) {
      push({
        id: 'funnel:response-time',
        category: 'FUNNEL',
        title: 'O primeiro atendimento demora a responder',
        problem: `A mediana do primeiro retorno é de ${num(q.medianResponseMinutes)} minutos.`,
        evidence: [
          fact(`Mediana de ${num(q.medianResponseMinutes)} minutos até a primeira resposta.`, 'CRM'),
          ...(q.slowResponseShare !== null
            ? [fact(`${pct(q.slowResponseShare, 0)} dos contatos esperaram mais de 1 hora.`, 'CRM')]
            : []),
          hypothesis('Quem pesquisa um fornecedor costuma falar com vários; respostas lentas perdem para o concorrente.'),
        ],
        impact: {
          description: 'Melhorar o tempo de resposta tende a aumentar a taxa de qualificação sem gastar mais com anúncio.',
          basis: 'Relação típica de mercado, não medida nesta conta.',
        },
        action: 'Definir um prazo-alvo de resposta (ex.: 15 minutos em horário comercial) e automatizar a primeira resposta.',
        confidence: { level: 'MEDIUM', reasons: ['Medido no CRM, mas o impacto na venda é estimado.'] },
        validation: 'A mediana cai e a taxa de contatos qualificados sobe nas semanas seguintes.',
      });
    }
  }

  // ───── Intenção e páginas ─────
  for (const f of input.pageFindings
    .filter((p) => p.recommendation.kind === 'REDIRECT' || p.recommendation.kind === 'CREATE')
    .filter((p) => p.cluster.cost >= 10)
    .slice(0, 4)) {
    const rec = f.recommendation;
    const topics = f.cluster.topics.join(' ');
    if (rec.kind === 'REDIRECT' && rec.best) {
      push({
        id: `landing:redirect:${f.cluster.id}`,
        category: 'LANDING_PAGE',
        title: `Buscas sobre "${f.cluster.label}" pousam em uma página pouco aderente`,
        problem: `${plural(f.cluster.terms.length, 'busca', 'buscas')} sobre "${topics}" levam à página ${f.currentUrls[0] ?? 'atual'}, mas existe uma página mais adequada.`,
        evidence: [
          fact(`${num(f.cluster.clicks)} cliques e ${brl(f.cluster.cost)} nesse assunto.`),
          fact(
            `A página sugerida (${rec.best.url}) cobre ${pct(rec.bestScore, 0)} do assunto${
              rec.currentScore !== null ? `, contra ${pct(rec.currentScore, 0)} da atual` : ''
            }.`,
            'CALCULATION',
          ),
          hypothesis('Uma página mais específica tende a converter melhor; isso precisa ser medido.'),
          ...(f.coherence === null
            ? [missing('A página atual não foi lida; a coerência é estimada pelo endereço.', 'SITE')]
            : []),
        ],
        impact: {
          monthlyCostBrl: (f.cluster.cost / Math.max(1, input.windowDays)) * 30,
          description: 'Mais aderência entre busca, anúncio e página costuma aumentar a taxa de conversão do tráfego pago.',
          basis: 'Hipótese a ser testada: a melhora esperada não é garantida.',
        },
        action: `Testar a troca da URL final dos anúncios desse assunto para ${rec.best.url}, registrando a hipótese para comparar antes e depois.`,
        actionButton: {
          label: 'Criar hipótese de teste',
          kind: 'ROUTE',
          route: '/intencao',
          queryParams: { cluster: f.cluster.id },
        },
        confidence: { level: f.cluster.clicks >= 30 ? 'MEDIUM' : 'LOW', reasons: ['Cobertura medida por texto; efeito ainda é hipótese.'] },
        validation: 'Comparar a taxa de conversão dos mesmos anúncios por 14 dias antes e depois da troca (ou rodar como experimento).',
      });
    } else if (rec.kind === 'CREATE') {
      push({
        id: `landing:create:${f.cluster.id}`,
        category: 'LANDING_PAGE',
        title: `Falta uma página para "${f.cluster.label}"`,
        problem: `O assunto "${topics}" recebe tráfego pago, mas nenhuma página conhecida cobre o que as pessoas procuram.`,
        evidence: [
          fact(`${num(f.cluster.clicks)} cliques e ${brl(f.cluster.cost)} nesse assunto.`),
          fact(`A melhor página conhecida cobre ${pct(rec.bestScore, 0)} do assunto.`, 'CALCULATION'),
          hypothesis('Uma página dedicada tende a melhorar a conversão deste assunto.'),
        ],
        impact: {
          monthlyCostBrl: (f.cluster.cost / Math.max(1, input.windowDays)) * 30,
          description: 'Tráfego pago passa a chegar a uma página que responde exatamente ao que foi buscado.',
          basis: 'Hipótese: depende da qualidade da página criada.',
        },
        action: `Criar uma página sobre "${rec.suggestedTitle ?? topics}" com a oferta, prova e um próximo passo claro.`,
        actionButton: { label: 'Registrar no conteúdo', kind: 'ROUTE', route: '/conteudo' },
        confidence: { level: f.cluster.clicks >= 30 ? 'MEDIUM' : 'LOW', reasons: ['Cobertura medida por texto das páginas conhecidas.'] },
        validation: 'Comparar a taxa de conversão desse assunto antes e depois da nova página.',
      });
    }
  }

  // ───── Conteúdo ─────
  for (const o of input.contentOpportunities.slice(0, 4)) {
    push({
      id: `content:${o.id}`,
      category: 'CONTENT',
      title:
        o.type === 'PUBLISH'
          ? `Publicar sobre "${o.topic}"`
          : o.type === 'UPDATE'
            ? `Atualizar conteúdo sobre "${o.topic}"`
            : `Distribuir conteúdo sobre "${o.topic}"`,
      problem:
        o.type === 'PUBLISH'
          ? 'Há demanda real por este assunto e nenhum conteúdo conhecido o cobre.'
          : o.type === 'UPDATE'
            ? 'Existe conteúdo, mas há sinais de que ele não está entregando o que poderia.'
            : 'Existe conteúdo com tração que não é aproveitado na mídia paga.',
      evidence: o.evidence,
      impact: {
        description:
          'Conteúdo não gera resultado imediato: o efeito aparece em semanas e não deve ser atribuído automaticamente à última publicação.',
        basis: 'Avaliação ao longo do tempo, com comparação contra páginas que não mudaram.',
      },
      action: o.action,
      actionButton: { label: 'Abrir conteúdo', kind: 'ROUTE', route: '/conteudo' },
      confidence: o.confidence,
      validation: 'Acompanhar impressões, cliques e eventos-chave da página por 4 a 8 semanas, separando outras mudanças do período.',
      // Conteúdo é benefício lento e incerto: nunca deve passar de desperdício ou falha medidos.
      priority: Math.round(Math.min(35, o.priority * 0.4)),
    });
  }

  // ───── Qualidade dos dados ─────
  if (input.funnel.adsValue.isStatic) {
    push({
      id: 'data:static-value',
      category: 'DATA_QUALITY',
      title: 'O valor das conversões no Google Ads é fixo: não é receita',
      problem: `Cada conversão está valendo ${
        input.funnel.adsValue.perConversion !== null ? brl(input.funnel.adsValue.perConversion) : 'o mesmo valor'
      } no Google Ads, qualquer que seja o negócio fechado.`,
      evidence: [
        fact(
          `Valor total atribuído: ${brl(input.funnel.adsValue.total)}, sempre com o mesmo valor por conversão.`,
        ),
        hypothesis('Relatórios de ROAS do Google Ads tendem a parecer melhores do que a realidade.'),
      ],
      impact: {
        description: 'Evita decidir verba com base em um retorno que não existe.',
        basis: 'Este painel só calcula receita e ROI a partir de vendas do CRM.',
      },
      action: 'Importar as vendas do CRM (com valor) e, se quiser, devolver conversões offline ao Google Ads.',
      actionButton: { label: 'Importar vendas', kind: 'ROUTE', route: '/funil' },
      confidence: { level: 'HIGH', reasons: ['Valor idêntico em todas as conversões.'] },
      validation: 'O painel passa a mostrar receita e ROI reais.',
    });
  }

  if (!input.sources.crm) {
    push({
      id: 'data:no-crm',
      category: 'DATA_QUALITY',
      title: 'Sem dados do CRM, não dá para medir qualidade, venda nem ROI',
      problem: 'O Google Ads só enxerga o contato inicial. Qualificação, proposta, venda e receita não aparecem.',
      evidence: [
        fact(`Contatos no Google Ads: ${num(input.funnel.total.stages.CONTACT.ads)}.`),
        missing('Nenhum lead importado do CRM no período.', 'CRM'),
      ],
      impact: {
        description: 'Passa a ser possível medir custo por lead qualificado, custo por cliente e ROI.',
        basis: 'Depende da importação dos leads.',
      },
      action: 'Importar os leads do CRM (CSV) com campanha, etapa, valor e margem.',
      actionButton: { label: 'Importar leads', kind: 'ROUTE', route: '/funil' },
      confidence: { level: 'HIGH', reasons: ['A informação não existe nos dados atuais.'] },
      validation: 'Os estágios Qualificado, Proposta e Venda passam a ter números.',
    });
  }

  if (input.funnel.unconfirmedConversions > 0) {
    push({
      id: 'data:unconfirmed-mapping',
      category: 'DATA_QUALITY',
      title: 'Confirme o que cada conversão do Google Ads significa',
      problem: `${num(input.funnel.unconfirmedConversions, 1)} conversões estão classificadas só por sugestão automática.`,
      evidence: [
        hypothesis('A sugestão usa o nome e a categoria da ação, o que pode estar errado (ex.: clique no WhatsApp cadastrado como contato).'),
      ],
      impact: {
        description: 'Evita tratar um clique no WhatsApp como contato real ou lead qualificado.',
        basis: 'Depende de você confirmar.',
      },
      action: 'Na tela de funil, confirme o estágio de cada ação de conversão.',
      actionButton: { label: 'Confirmar mapeamento', kind: 'ROUTE', route: '/funil' },
      confidence: { level: 'HIGH', reasons: ['Mapeamento ainda não confirmado.'] },
      validation: 'Todas as ações aparecem como "confirmado".',
    });
  }

  if (input.goal.targetCostPerGoal === null) {
    push({
      id: 'data:no-target',
      category: 'DATA_QUALITY',
      title: `Defina quanto vale pagar por ${stage}`,
      problem: 'Sem meta, o painel compara cada linha com a média da conta, o que só mostra quem está acima ou abaixo da média.',
      evidence: [missing('Meta de custo por resultado não configurada.', 'CONFIG')],
      impact: { description: 'Veredito de "acima da meta" passa a ter um número que faz sentido para o negócio.', basis: 'Depende de você definir.' },
      action: 'Em Qualidade do funil, informe o custo máximo aceitável por resultado.',
      actionButton: { label: 'Definir meta', kind: 'ROUTE', route: '/funil' },
      confidence: { level: 'HIGH', reasons: ['A informação não existe na configuração.'] },
      validation: 'Os vereditos passam a citar a meta configurada.',
    });
  }

  if (input.maturity < 0.5) {
    push({
      id: 'data:immature',
      category: 'DATA_QUALITY',
      title: 'Os resultados deste período ainda estão amadurecendo',
      problem: `Só ${pct(input.maturity, 0)} do período já teve tempo de gerar ${stage}.`,
      evidence: [
        fact(`Prazo típico até ${stage}: ${days(input.goal.stageLagDays[input.goal.goalStage] ?? input.goal.salesCycleDays)}.`, 'CONFIG'),
        hypothesis('Parte do que hoje parece "sem resultado" ainda pode virar resultado.'),
      ],
      impact: { description: 'Evita cortar gasto que ainda não teve tempo de provar valor.', basis: 'Baseado no prazo configurado.' },
      action: `Evite cortes baseados neste período. A janela fica madura em ${input.maturesOn}.`,
      confidence: { level: 'HIGH', reasons: ['Derivado do prazo configurado.'] },
      validation: 'Reavalie depois da data indicada.',
    });
  }

  if (input.searchCoverage !== null && input.searchCoverage < 0.6) {
    push({
      id: 'data:coverage',
      category: 'DATA_QUALITY',
      title: 'Os termos de pesquisa visíveis explicam pouco do custo',
      problem: `Os termos exibidos pelo Google cobrem só ${pct(input.searchCoverage, 0)} do custo de Pesquisa.`,
      evidence: [
        fact(`Cobertura: ${pct(input.searchCoverage, 0)} do custo de Pesquisa.`),
        hypothesis('O restante vem de termos de baixo volume que o Google oculta.'),
      ],
      impact: { description: 'As conclusões por termo valem só para a parte visível.', basis: 'Limite do relatório do Google Ads.' },
      action: 'Use também os relatórios por campanha, grupo e palavra-chave para decidir.',
      confidence: { level: 'HIGH', reasons: ['Cálculo direto.'] },
      validation: 'Não se aplica.',
    });
  }

  if (input.sources.ga4.configured === false || input.sources.searchConsole.configured === false) {
    const names = [
      input.sources.ga4.configured ? '' : 'Google Analytics',
      input.sources.searchConsole.configured ? '' : 'Search Console',
    ].filter(Boolean);
    push({
      id: 'data:sources',
      category: 'DATA_QUALITY',
      title: `Conecte ${names.join(' e ')}`,
      problem: 'Sem essas fontes, o painel não consegue medir o comportamento no site nem a demanda orgânica.',
      evidence: [
        ...(input.sources.ga4.configured ? [] : [missing(input.sources.ga4.reason ?? 'Google Analytics não conectado.', 'GA4')]),
        ...(input.sources.searchConsole.configured
          ? []
          : [missing(input.sources.searchConsole.reason ?? 'Search Console não conectado.', 'SEARCH_CONSOLE')]),
      ],
      impact: {
        description: 'Libera a análise de páginas, de abandono e de oportunidades de conteúdo.',
        basis: 'Depende de credenciais e de informar a propriedade/site.',
      },
      action: 'Siga o passo a passo do README (novas permissões OAuth) e informe os IDs em Configurações.',
      actionButton: { label: 'Abrir configurações', kind: 'ROUTE', route: '/configuracoes' },
      confidence: { level: 'HIGH', reasons: ['Fonte não configurada.'] },
      validation: 'As telas de páginas e conteúdo passam a mostrar sessões, engajamento e consultas.',
    });
  }

  return out.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, 'pt-BR'));
}
