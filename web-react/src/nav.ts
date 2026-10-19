/**
 * Menu lateral. Mesmos grupos, rótulos e caminhos de `web/src/app/app.ts` (Angular, Oficial),
 * para que os endereços sejam idênticos nas duas versões.
 */
import type { IconName } from '@shared/shared/icons';

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Inteligência',
    items: [
      { path: 'visao-geral', icon: 'home', label: 'Visão geral' },
      { path: 'funil', icon: 'funnel', label: 'Qualidade do funil' },
      { path: 'desperdicios', icon: 'ban', label: 'Desperdícios' },
      { path: 'intencao', icon: 'link', label: 'Intenção e páginas' },
      { path: 'conteudo', icon: 'document', label: 'Conteúdo' },
      { path: 'acoes', icon: 'clipboard', label: 'Plano de ação' },
      { path: 'historico', icon: 'history', label: 'Histórico e aprendizado' },
    ],
  },
  {
    title: 'Operação no Google Ads',
    items: [
      { path: 'termos', icon: 'search', label: 'Termos de pesquisa' },
      { path: 'negativas', icon: 'shield', label: 'Palavras negativas' },
      { path: 'palavras', icon: 'tag', label: 'Palavras-chave' },
      { path: 'campanhas', icon: 'folder', label: 'Campanhas' },
      { path: 'dispositivos', icon: 'desktop', label: 'Dispositivos e redes' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { path: 'rastreamento', icon: 'tag', label: 'Rastreamento' },
      { path: 'configuracoes', icon: 'cog', label: 'Configurações' },
      { path: 'ajuda-instalacao', icon: 'question', label: 'Ajuda de instalação' },
    ],
  },
];
