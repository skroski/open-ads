import { IconName } from './shared/icons';

export interface NavTab {
  path: string;
  label: string;
}

export interface NavSection {
  /** Rota de entrada da área (primeira aba). */
  path: string;
  label: string;
  icon: IconName;
  /** Abas contextuais da área; vazio quando a área é uma página única. */
  tabs: NavTab[];
  /** Pergunta de dinheiro que a área responde (título da área). */
  question: string;
  subtitle: string;
}

/**
 * Seis áreas orientadas a decisão. As dimensões do Google Ads viram abas
 * dentro da área, então toda tela continua alcançável pela navegação.
 */
export const NAV_SECTIONS: NavSection[] = [
  { path: 'visao-geral', label: 'Hoje', icon: 'home', tabs: [], question: 'O seu dinheiro está sendo bem usado?', subtitle: '' },
  {
    path: 'eficiencia',
    label: 'Investimento',
    icon: 'currency',
    question: 'Para onde o dinheiro está indo?',
    subtitle: 'Compare onde investiu, o que voltou e quanto desse gasto merece revisão.',
    tabs: [
      { path: 'eficiencia', label: 'Visão do dinheiro' },
      { path: 'campanhas', label: 'Campanhas' },
      { path: 'termos', label: 'Termos de pesquisa' },
      { path: 'palavras', label: 'Palavras-chave' },
      { path: 'dispositivos', label: 'Dispositivos e redes' },
      { path: 'performance-max', label: 'Performance Max' },
    ],
  },
  {
    path: 'oportunidades',
    label: 'Oportunidades',
    icon: 'target',
    question: 'Onde agir primeiro?',
    subtitle: 'Achados ordenados por dinheiro envolvido e confiança, cada um com o motivo de estar na fila.',
    tabs: [
      { path: 'oportunidades', label: 'Central' },
      { path: 'desperdicios', label: 'Economia' },
      { path: 'intencao', label: 'Intenção e páginas' },
      { path: 'conteudo', label: 'Conteúdo' },
    ],
  },
  {
    path: 'funil',
    label: 'Medição e funil',
    icon: 'funnel',
    question: 'Posso confiar no que estou vendo?',
    subtitle: 'Confira a qualidade da medição antes de cortar ou aumentar o investimento.',
    tabs: [
      { path: 'funil', label: 'Qualidade do funil' },
      { path: 'rastreamento', label: 'Rastreamento' },
    ],
  },
  {
    path: 'acoes',
    label: 'Ações e aprendizado',
    icon: 'history',
    question: 'O que já fizemos e o que aprendemos?',
    subtitle: 'Planeje, acompanhe e registre cada decisão tomada na conta.',
    tabs: [
      { path: 'acoes', label: 'Plano de ação' },
      { path: 'negativas', label: 'Palavras negativas' },
      { path: 'publico-display', label: 'Público do Display' },
      { path: 'experimentos', label: 'Experimentos' },
      { path: 'historico', label: 'Auditoria' },
    ],
  },
  {
    path: 'configuracoes',
    label: 'Configurações',
    icon: 'cog',
    question: 'Qual é a régua do seu investimento?',
    subtitle: 'Metas, conexões e ajuda para instalar o painel.',
    tabs: [
      { path: 'configuracoes', label: 'Metas e conexões' },
      { path: 'ajuda-instalacao', label: 'Ajuda de instalação' },
    ],
  },
];

/** Área à qual a URL pertence, ou null para rotas desconhecidas. */
export function sectionForUrl(url: string): NavSection | null {
  const first = url.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? '';
  return NAV_SECTIONS.find((s) => s.path === first || s.tabs.some((t) => t.path === first)) ?? null;
}
