import { NAV_SECTIONS, sectionForUrl } from './nav';

describe('navegação', () => {
  it('liga cada sub-tela à sua área', () => {
    expect(sectionForUrl('/termos')?.label).toBe('Investimento');
    expect(sectionForUrl('/negativas?x=1')?.label).toBe('Ações e aprendizado');
    expect(sectionForUrl('/desperdicios')?.label).toBe('Oportunidades');
    expect(sectionForUrl('/ajuda-instalacao')?.label).toBe('Configurações');
    expect(sectionForUrl('/visao-geral')?.label).toBe('Hoje');
    expect(sectionForUrl('/nada')).toBeNull();
  });

  it('não repete rotas entre áreas', () => {
    const all = NAV_SECTIONS.flatMap((s) => s.tabs.map((t) => t.path));
    expect(new Set(all).size).toBe(all.length);
  });

  it('cobre todas as telas do roteador', () => {
    const covered = new Set([...NAV_SECTIONS.map((s) => s.path), ...NAV_SECTIONS.flatMap((s) => s.tabs.map((t) => t.path))]);
    for (const p of ['visao-geral', 'funil', 'eficiencia', 'desperdicios', 'intencao', 'conteudo', 'acoes', 'oportunidades', 'experimentos', 'historico', 'termos', 'negativas', 'palavras', 'campanhas', 'performance-max', 'dispositivos', 'configuracoes', 'rastreamento', 'ajuda-instalacao']) {
      expect(covered.has(p)).toBe(true);
    }
  });
});
