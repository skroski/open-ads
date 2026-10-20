import { Routes } from '@angular/router';

const TITLE = 'Inteligência de Marketing';

/** Todas as telas carregam sob demanda para manter o bundle inicial pequeno. */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'visao-geral' },
  {
    path: 'visao-geral',
    title: `Visão geral · ${TITLE}`,
    loadComponent: () => import('./features/overview/overview').then((m) => m.Overview),
  },
  {
    path: 'funil',
    title: `Qualidade do funil · ${TITLE}`,
    loadComponent: () => import('./features/funnel/funnel').then((m) => m.FunnelPage),
  },
  {
    path: 'eficiencia',
    title: `Eficiência da mídia · ${TITLE}`,
    loadComponent: () => import('./features/efficiency/efficiency').then((m) => m.EfficiencyPage),
  },
  {
    path: 'desperdicios',
    title: `Desperdícios · ${TITLE}`,
    loadComponent: () => import('./features/waste/waste').then((m) => m.WastePage),
  },
  {
    path: 'intencao',
    title: `Intenção e páginas · ${TITLE}`,
    loadComponent: () => import('./features/intent/intent').then((m) => m.IntentPage),
  },
  {
    path: 'conteudo',
    title: `Conteúdo · ${TITLE}`,
    loadComponent: () => import('./features/content/content').then((m) => m.ContentPage),
  },
  {
    path: 'acoes',
    title: `Plano de ação · ${TITLE}`,
    loadComponent: () => import('./features/actions/actions').then((m) => m.ActionsPage),
  },
  {
    path: 'historico',
    title: `Histórico e aprendizado · ${TITLE}`,
    loadComponent: () => import('./features/history/history').then((m) => m.HistoryPage),
  },
  {
    path: 'termos',
    title: `Termos de pesquisa · ${TITLE}`,
    loadComponent: () => import('./features/operations/terms').then((m) => m.TermsPage),
  },
  {
    path: 'negativas',
    title: `Palavras negativas · ${TITLE}`,
    loadComponent: () => import('./features/operations/negatives').then((m) => m.NegativesPage),
  },
  {
    path: 'palavras',
    title: `Palavras-chave · ${TITLE}`,
    loadComponent: () => import('./features/operations/keywords').then((m) => m.KeywordsPage),
  },
  {
    path: 'campanhas',
    title: `Campanhas · ${TITLE}`,
    loadComponent: () => import('./features/operations/campaigns').then((m) => m.CampaignsPage),
  },
  {
    path: 'dispositivos',
    title: `Dispositivos e redes · ${TITLE}`,
    loadComponent: () => import('./features/operations/devices').then((m) => m.DevicesPage),
  },
  {
    path: 'configuracoes',
    title: `Configurações · ${TITLE}`,
    loadComponent: () => import('./features/settings/settings').then((m) => m.SettingsPage),
  },
  {
    path: 'rastreamento',
    title: `Rastreamento · ${TITLE}`,
    loadComponent: () => import('./features/tracking/tracking').then((m) => m.TrackingPage),
  },
  {
    path: 'ajuda-instalacao',
    title: `Ajuda de instalação · ${TITLE}`,
    loadComponent: () =>
      import('./features/installation-help/installation-help').then((m) => m.InstallationHelpPage),
  },
  { path: '**', redirectTo: 'visao-geral' },
];
