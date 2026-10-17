import { HELP_JOURNEYS, journeyForUrl } from './onboarding-journey';

describe('jornada da ajuda guiada', () => {
  it('mantém uma jornada completa e narrada para cada módulo', () => {
    expect(HELP_JOURNEYS.map((journey) => journey.route)).toEqual([
      'visao-geral', 'funil', 'desperdicios', 'intencao', 'conteudo', 'acoes', 'historico',
      'termos', 'negativas', 'palavras', 'campanhas', 'dispositivos', 'configuracoes',
    ]);
    expect(new Set(HELP_JOURNEYS.flatMap((journey) => journey.steps.map((step) => step.id))).size).toBe(52);
    expect(HELP_JOURNEYS.every((journey) => journey.steps.length === 4)).toBe(true);
    expect(HELP_JOURNEYS.every((journey) => journey.steps.every((step) => step.target.startsWith('[data-open-help=')))).toBe(true);
    expect(HELP_JOURNEYS.every((journey) => journey.steps.every((step) => step.narration.trim().length > 0))).toBe(true);
  });

  it('resolve a jornada pela rota atual', () => {
    expect(journeyForUrl('/desperdicios?periodo=30')).toMatchObject({ id: 'desperdicios' });
    expect(journeyForUrl('/rota-inexistente')).toMatchObject({ id: 'visao-geral' });
  });
});
