import { hypothesisFromRecommendation, hypothesisTitle, pickForAutoDraft } from './hypothesis-draft';

const rec = (title: string, priority: number, status = 'OPEN') => ({ title, priority, status });

describe('hypothesis-draft', () => {
  it('cria rascunho com campanha, método e situação seguros', () => {
    const draft = hypothesisFromRecommendation(
      { category: 'CAMPAIGN', title: 'Pausar X', action: 'Pausar X', problem: 'Gasta sem converter.', entity: { type: 'campaign', id: '7', label: 'X' } },
      '2026-01-01T00:00:00.000Z',
    );
    expect(draft).toMatchObject({ kind: 'BID', status: 'DRAFT', method: 'EXPERIMENT', campaignId: '7', title: 'Validar: Pausar X' });
    expect(draft.statement).toContain('gasta sem converter.');
  });

  it('escolhe só abertas, por prioridade, sem repetir hipótese existente e respeitando o limite', () => {
    const picked = pickForAutoDraft(
      [rec('A', 10), rec('B', 90), rec('C', 50, 'DISMISSED'), rec('D', 70), rec('E', 30, 'ACCEPTED'), rec('F', 80)],
      [hypothesisTitle({ title: 'F' })],
      2,
    );
    expect(picked.map((r) => r.title)).toEqual(['B', 'D']);
  });
});
