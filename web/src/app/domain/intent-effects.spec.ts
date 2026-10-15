import { prepareAuditRules, DEFAULT_AUDIT_RULES } from './classify';
import { addDays } from './dates';
import { evaluateChange, evaluateSeriesChange } from './effects';
import {
  CandidatePage,
  clusterTerms,
  coherenceOf,
  inferIntent,
  intentFit,
  pageTextOf,
  recommendPage,
} from './intent';
import { ChangeEntry, DailyRow, PageAudit, SearchTermRow, SeriesPoint } from './models';

const brand = prepareAuditRules({ ...DEFAULT_AUDIT_RULES, brandTerms: ['acme'] }).brand;

describe('inferIntent', () => {
  it('separa quem não compra antes de tudo', () => {
    expect(inferIntent('vaga de estagio em clinica odontologica', brand)).toBe('JOB');
    expect(inferIntent('chatbot gratis para clinica', brand)).toBe('FREE');
    expect(inferIntent('acme login', brand)).toBe('SUPPORT');
  });

  it('marca sem login é navegacional', () => {
    expect(inferIntent('acme', brand)).toBe('NAVIGATIONAL');
  });

  it('reconhece intenção transacional, comercial e informacional', () => {
    expect(inferIntent('quanto custa software para clinica odontologica', brand)).toBe('TRANSACTIONAL');
    expect(inferIntent('software para clinica odontologica', brand)).toBe('COMMERCIAL');
    expect(inferIntent('como automatizar atendimento de clinica', brand)).toBe('INFORMATIONAL');
  });

  it('não confunde "odontologica" com a palavra "ia"', () => {
    expect(inferIntent('odontologica perto de mim', brand)).toBe('UNKNOWN');
  });

  it('mede o encaixe com uma oferta de venda', () => {
    expect(intentFit('JOB')).toBe('BAD');
    expect(intentFit('INFORMATIONAL')).toBe('WEAK');
    expect(intentFit('TRANSACTIONAL')).toBe('GOOD');
  });
});

describe('coerência termo → anúncio → página', () => {
  it('é alta quando anúncio e página falam do que a pessoa buscou', () => {
    const page = pageTextOf('https://x.com/ia-para-clinicas-odontologicas/', undefined);
    const c = coherenceOf('ia para clinicas odontologicas', ['IA para Clínicas Odontológicas', 'Chatbot Clínica'], page);
    expect(c.score).toBeGreaterThan(0.8);
    expect(c.weakest).toBeNull();
  });

  it('aponta a página como elo fraco quando só a home é conhecida pela URL', () => {
    const page = pageTextOf('https://exemplo.com.br/receitas-de-bolo/', undefined);
    const c = coherenceOf('chatbot para clinica odontologica', ['Chatbot Clínica Odontológica'], page);
    expect(c.termToAd).toBeGreaterThan(0.5);
    expect(c.termToPage).toBe(0);
    expect(c.weakest).toBe('PAGE');
  });

  it('página sem texto conhecido é indisponível, não zero', () => {
    const page = pageTextOf('https://exemplo.com.br', undefined);
    expect(page.basis).toBe('NONE');
    const c = coherenceOf('chatbot odontologico', [], page);
    expect(c.termToPage).toBeNull();
    expect(c.score).toBeNull();
  });

  it('usa título e h1 da página quando auditada', () => {
    const audit: PageAudit = {
      url: 'https://exemplo.com.br',
      normalizedUrl: 'exemplo.com.br',
      fetchedAt: '2026-10-13',
      status: 200,
      ok: true,
      title: 'Chatbot para clínicas odontológicas | Acme',
      h1: ['Atendimento automático no WhatsApp'],
      h2: [],
      forms: 1,
      telLinks: 0,
      whatsappLinks: 1,
      hasViewport: true,
      hasCanonical: true,
      noindex: false,
      trackingTags: ['gtag'],
      wordCount: 400,
    };
    const page = pageTextOf('https://exemplo.com.br', audit);
    expect(page.basis).toBe('AUDIT');
    expect(coherenceOf('chatbot clinica odontologica', ['Chatbot'], page).termToPage).toBe(1);
  });
});

const term = (t: string, cost: number, clicks = 10, conversions = 0): SearchTermRow => ({
  term: t,
  campaignId: '1',
  campaignName: 'C',
  adGroupId: 'g',
  adGroupName: 'G',
  excluded: false,
  alreadyNegative: false,
  category: 'GENERAL',
  categoryReason: '',
  impressions: clicks * 10,
  clicks,
  cost,
  conversions,
});

describe('clusterTerms e recommendPage', () => {
  const terms = [
    term('chatbot para clinica odontologica', 30),
    term('chatbot clinica odontologica whatsapp', 20),
    term('crm odontologico', 15),
    term('crm para odontologico', 10),
    term('pet shop receitas', 5),
  ];

  it('agrupa termos parecidos e separa assuntos diferentes', () => {
    const clusters = clusterTerms(terms, brand);
    expect(clusters.length).toBeGreaterThanOrEqual(3);
    const chatbot = clusters.find((c) => c.topics.includes('chatbot'));
    expect(chatbot?.terms.length).toBe(2);
    expect(chatbot?.cost).toBe(50);
  });

  const candidates: CandidatePage[] = [
    { url: 'https://s.com.br', normalizedUrl: 's.com.br', words: [], basis: 'NONE', origin: 'usada nos anúncios' },
    {
      url: 'https://s.com.br/chatbot-clinica-odontologica/',
      normalizedUrl: 's.com.br/chatbot-clinica-odontologica',
      words: ['chatbot', 'clinica', 'odontologica'],
      basis: 'URL',
      origin: 'conteúdo publicado',
    },
  ];

  it('recomenda trocar para a página que cobre melhor o assunto', () => {
    const cluster = clusterTerms(terms, brand).find((c) => c.topics.includes('chatbot'))!;
    const rec = recommendPage(cluster, ['https://s.com.br'], candidates);
    expect(rec.kind).toBe('REDIRECT');
    expect(rec.best?.url).toContain('chatbot-clinica-odontologica');
  });

  it('mantém quando a página atual já é a melhor', () => {
    const cluster = clusterTerms(terms, brand).find((c) => c.topics.includes('chatbot'))!;
    const rec = recommendPage(cluster, ['https://www.s.com.br/chatbot-clinica-odontologica'], candidates);
    expect(rec.kind).toBe('KEEP');
  });

  it('sugere criar página quando nenhuma cobre o assunto', () => {
    const cluster = clusterTerms(terms, brand).find((c) => c.topics.includes('crm'))!;
    const rec = recommendPage(cluster, ['https://s.com.br'], candidates);
    expect(rec.kind).toBe('CREATE');
    expect(rec.suggestedTitle).toBeTruthy();
  });

  it('sem texto de nenhuma página, o resultado é desconhecido (não "criar")', () => {
    const cluster = clusterTerms(terms, brand)[0];
    const rec = recommendPage(cluster, ['https://s.com.br'], [candidates[0]]);
    expect(rec.kind).toBe('UNKNOWN');
  });
});

describe('evaluateChange', () => {
  const day0 = '2026-09-01';
  const series = (id: string, from: string, days: number, clicks: number, rate: (i: number) => number): DailyRow[] =>
    Array.from({ length: days }, (_, i) => ({
      date: addDays(from, i),
      campaignId: id,
      campaignName: id,
      impressions: clicks * 10,
      clicks,
      cost: clicks * 3,
      conversions: Math.round(clicks * rate(i)),
    }));

  const change = (over: Partial<ChangeEntry> = {}): ChangeEntry => ({
    id: 'c1',
    accountId: 'a',
    at: '2026-09-21T10:00:00',
    kind: 'URL',
    title: 'Trocou a URL final',
    source: 'MANUAL',
    campaignId: 'A',
    ...over,
  });

  const today = '2026-10-10';

  it('aguarda quando ainda não há dias suficientes depois da mudança', () => {
    const r = evaluateChange(change({ at: '2026-10-08T10:00:00' }), series('A', day0, 38, 20, () => 0.1), [], { today });
    expect(r.verdict).toBe('WAITING');
    expect(r.waitUntil).toBe('2026-10-15');
  });

  it('detecta melhora relevante quando o controle não mudou', () => {
    const daily = [
      ...series('A', day0, 38, 30, (i) => (i < 20 ? 0.1 : 0.25)),
      ...series('B', day0, 38, 30, () => 0.1),
    ];
    const r = evaluateChange(change(), daily, [], { today });
    expect(r.verdict).toBe('IMPROVED');
    expect(r.rateLift).toBeGreaterThan(1);
    expect(r.confidence.level).not.toBe('LOW');
    expect(r.regression).toBe(false);
  });

  it('marca regressão quando piora de forma relevante', () => {
    const daily = [
      ...series('A', day0, 38, 30, (i) => (i < 20 ? 0.3 : 0.1)),
      ...series('B', day0, 38, 30, () => 0.2),
    ];
    const r = evaluateChange(change(), daily, [], { today });
    expect(r.verdict).toBe('WORSENED');
    expect(r.regression).toBe(true);
  });

  it('não atribui à mudança quando o grupo de controle variou igual', () => {
    const daily = [
      ...series('A', day0, 38, 30, (i) => (i < 20 ? 0.1 : 0.25)),
      ...series('B', day0, 38, 30, (i) => (i < 20 ? 0.1 : 0.25)),
    ];
    const r = evaluateChange(change(), daily, [], { today });
    expect(r.verdict).toBe('NO_CLEAR_EFFECT');
    expect(r.confidence.reasons.join(' ')).toContain('controle');
  });

  it('uma outra mudança no intervalo limita a confiança a média; duas derrubam para baixa', () => {
    const daily = series('A', day0, 38, 30, (i) => (i < 20 ? 0.1 : 0.3));
    const other = change({ id: 'c2', at: '2026-09-25T09:00:00', title: 'Pausou palavra' });
    const one = evaluateChange(change(), daily, [other], { today });
    expect(one.confounders).toHaveLength(1);
    expect(one.confidence.level).toBe('MEDIUM');

    const another = change({ id: 'c3', at: '2026-10-01T09:00:00', title: 'Ajustou lance' });
    const two = evaluateChange(change(), daily, [other, another], { today });
    expect(two.confounders).toHaveLength(2);
    expect(two.confidence.level).toBe('LOW');
  });

  it('mudanças em outra campanha não confundem o efeito desta', () => {
    const daily = series('A', day0, 38, 30, (i) => (i < 20 ? 0.1 : 0.3));
    const elsewhere = change({ id: 'c4', at: '2026-09-25T09:00:00', campaignId: 'Z' });
    expect(evaluateChange(change(), daily, [elsewhere], { today }).confounders).toHaveLength(0);
  });

  it('com poucos cliques não avalia', () => {
    const daily = series('A', day0, 38, 1, () => 0);
    const r = evaluateChange(change(), daily, [], { today });
    expect(r.verdict).toBe('NOT_EVALUABLE');
  });
});

describe('evaluateSeriesChange (conteúdo ao longo do tempo)', () => {
  const noise = (i: number): number => ((i * 7) % 5) - 2; // oscilação determinística de ±2
  const series = (from: string, days: number, base: (i: number) => number): SeriesPoint[] =>
    Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), value: base(i) + noise(i) }));
  const today = '2026-10-20';

  it('espera dias suficientes antes de concluir', () => {
    const s = series('2026-09-01', 50, () => 20);
    const r = evaluateSeriesChange(s, null, '2026-10-15', { today });
    expect(r.verdict).toBe('WAITING');
  });

  it('não atribui a alta à publicação quando o site inteiro subiu igual', () => {
    const page = series('2026-08-01', 80, (i) => (i < 40 ? 20 : 40));
    const site = series('2026-08-01', 80, (i) => (i < 40 ? 200 : 400));
    const r = evaluateSeriesChange(page, site, '2026-09-10', { today });
    expect(r.verdict).toBe('NO_CLEAR_EFFECT');
    expect(r.controlLift).toBeCloseTo(1, 1);
    expect(Math.abs(r.adjustedLift ?? 99)).toBeLessThan(0.1);
  });

  it('reconhece ganho real quando o controle ficou parado', () => {
    const page = series('2026-08-01', 80, (i) => (i < 40 ? 20 : 40));
    const site = series('2026-08-01', 80, () => 200);
    const r = evaluateSeriesChange(page, site, '2026-09-10', { today });
    expect(r.verdict).toBe('IMPROVED');
    expect(r.adjustedLift).toBeGreaterThan(0.5);
  });

  it('sem grupo de controle, a confiança não passa de média e o aviso aparece', () => {
    const page = series('2026-08-01', 80, (i) => (i < 40 ? 20 : 40));
    const r = evaluateSeriesChange(page, null, '2026-09-10', { today });
    expect(r.confidence.level).not.toBe('HIGH');
    expect(r.confidence.reasons.join(' ')).toContain('controle');
  });

  it('outras mudanças no período rebaixam a confiança', () => {
    const page = series('2026-08-01', 80, (i) => (i < 40 ? 20 : 40));
    const site = series('2026-08-01', 80, () => 200);
    const other = { id: 'o', accountId: 'a', at: '2026-09-15T10:00:00', kind: 'PAGE', title: 'x', source: 'MANUAL' } as ChangeEntry;
    const r = evaluateSeriesChange(page, site, '2026-09-10', { today, confounders: [other, { ...other, id: 'p' }] });
    expect(r.confidence.level).toBe('LOW');
  });
});
