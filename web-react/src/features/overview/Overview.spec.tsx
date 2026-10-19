import { screen, waitFor, within } from '@testing-library/react';
import { Overview } from './Overview';
import { mockApi, renderWithProviders } from '../../test-utils';

const campaign = {
  campaign: { id: '11', name: 'Pesquisa | Serviço', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
  metrics: { impressions: '1000', clicks: '100', costMicros: '250000000', conversions: '5' },
};

/** Linhas do Google Ads por tipo de consulta (reconhecidas por um trecho do GAQL). */
function rowsFor(query: string): unknown[] {
  if (query.includes('segments.conversion_action_name')) {
    return [
      {
        campaign: { id: '11' },
        segments: { conversionActionName: 'Formulário', conversionActionCategory: 'SUBMIT_LEAD_FORM' },
        metrics: { conversions: '5', allConversions: '5', conversionsValue: '0' },
      },
    ];
  }
  if (query.includes('FROM conversion_action')) {
    return [{ conversionAction: { id: '1', name: 'Formulário', category: 'SUBMIT_LEAD_FORM', type: 'WEBPAGE', status: 'ENABLED', primaryForGoal: true } }];
  }
  if (query.includes('segments.date,')) return [];
  if (query.includes('advertising_channel_type')) return [campaign];
  return [];
}

describe('Overview (React)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('mostra investimento, funil e saúde dos dados a partir das consultas à API', async () => {
    mockApi(rowsFor);
    renderWithProviders(<Overview />);

    expect(await screen.findByText('Investimento')).toBeInTheDocument();
    // 250.000.000 micros = R$ 250,00 (mesma conta do Angular, via normalizador compartilhado).
    expect(screen.getByText(/R\$\s*250,00/, { selector: '.stat-value' })).toBeInTheDocument();
    expect(screen.getByText('Funil do período')).toBeInTheDocument();
    const health = screen.getByText('Saúde dos dados').closest('section')!;
    expect(within(health).getByText('1 campanhas lidas')).toBeInTheDocument();
    expect(within(health).getByText('Google Ads conectado')).toBeInTheDocument();
  });

  it('diz que o estágio não tem fonte em vez de inventar zero', async () => {
    mockApi(rowsFor);
    renderWithProviders(<Overview />);
    await screen.findByText('Investimento');
    expect(screen.getByText('Indisponível: importe os leads do CRM')).toBeInTheDocument();
    expect(screen.getByText('Receita e ROI só existem com vendas do CRM')).toBeInTheDocument();
  });

  it('mostra o erro da API com a opção de tentar de novo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/accounts') {
          return new Response(JSON.stringify({ results: [{ customerClient: { id: '1234567890', descriptiveName: 'Conta Teste' } }], currentCustomerId: '1234567890' }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'USER_PERMISSION_DENIED' }), { status: 403, statusText: 'Forbidden' });
      }),
    );
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getByText('USER_PERMISSION_DENIED')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
