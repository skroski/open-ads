import { screen } from '@testing-library/react';
import { AUTHOR } from '@shared/brand';
import { App } from './App';
import { NAV_GROUPS } from './nav';
import { mockApi, renderWithProviders } from './test-utils';

describe('App (React)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('mostra a marca e todos os itens do menu, como no Angular', async () => {
    renderWithProviders(<App />, '/');
    expect(screen.getAllByAltText('OpenAds').length).toBeGreaterThan(0);
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      expect(screen.getAllByText(item.label).length).toBeGreaterThan(0);
    }
    await screen.findByRole('heading', { name: 'Visão geral' });
  });

  it('mantém o crédito de autoria exigido pela licença', () => {
    renderWithProviders(<App />, '/');
    expect(screen.getByText(`Criado por ${AUTHOR.name}`)).toBeInTheDocument();
  });

  it('mostra o marcador das telas ainda não portadas', async () => {
    renderWithProviders(<App />, '/funil');
    expect(await screen.findByText(/ainda não foi portada/i)).toBeInTheDocument();
  });

  it('mostra o nome da conta descoberta e o período escolhido', async () => {
    renderWithProviders(<App />, '/');
    // Aparece no botão da conta e na lista de contas do menu.
    expect((await screen.findAllByText('ID 123-456-7890')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Período de análise')).toHaveTextContent('Últimos 30 dias');
  });
});
