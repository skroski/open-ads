import { ONBOARDING_JOURNEY } from './onboarding-journey';

describe('jornada da ajuda guiada', () => {
  it('mantém etapas e alvos estáveis para a primeira análise', () => {
    expect(ONBOARDING_JOURNEY.id).toBe('primeira-analise');
    expect(ONBOARDING_JOURNEY.steps).toHaveLength(4);
    expect(new Set(ONBOARDING_JOURNEY.steps.map((step) => step.id)).size).toBe(ONBOARDING_JOURNEY.steps.length);
    expect(ONBOARDING_JOURNEY.steps.every((step) => step.target.startsWith('[data-open-help='))).toBe(true);
    expect(ONBOARDING_JOURNEY.steps.every((step) => step.narration.trim().length > 0)).toBe(true);
  });
});
