import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Workspace } from '../../core/workspace';
import { PmaxAssetGroupRow, PmaxAssetRow } from '../../domain/models';
import { EChart } from '../../shared/echart';
import { Icon } from '../../shared/icon';
import { ExportData, PageHeader } from '../../shared/page-header';
import type { EChartsCoreOption } from 'echarts/core';

const strengthLabel = (value: string): string =>
  ({
    EXCELLENT: 'Excelente',
    GOOD: 'Boa',
    AVERAGE: 'Média',
    POOR: 'Baixa',
    NO_ADS: 'Sem anúncios',
    PENDING: 'Pendente',
  }[value] ?? (value || 'Não informado'));

const strengthClass = (value: string): string => {
  const tone =
    value === 'EXCELLENT' || value === 'GOOD'
      ? 'badge-success'
      : value === 'AVERAGE'
        ? 'badge-warning'
        : value === 'POOR'
          ? 'badge-error'
          : 'badge-ghost';
  return `badge badge-soft badge-sm ${tone}`;
};

const fieldLabel = (value: string): string =>
  ({
    HEADLINE: 'Título',
    LONG_HEADLINE: 'Título longo',
    DESCRIPTION: 'Descrição',
    MARKETING_IMAGE: 'Imagem',
    SQUARE_MARKETING_IMAGE: 'Imagem quadrada',
    LOGO: 'Logotipo',
    YOUTUBE_VIDEO: 'Vídeo',
    BUSINESS_NAME: 'Nome da empresa',
    CALL_TO_ACTION_SELECTION: 'Chamada para ação',
  }[value] ?? (value || 'Outro recurso'));

interface AssetSummary {
  fieldType: string;
  count: number;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  limited: number;
}

/** Conjunto ilustrativo para demonstração das capacidades do Radar PMax quando a conta não tem o formato */
const DEMO_GROUPS: PmaxAssetGroupRow[] = [
  {
    id: 'demo-1',
    name: 'Grupo Principal - Captação e Tratamentos',
    campaignId: 'demo-c1',
    campaignName: 'PMax - Vendas & Conversões (Exemplo)',
    adStrength: 'EXCELLENT',
    assetCoverage: 'TOTAL',
    primaryStatus: 'ELIGIBLE',
    impressions: 18450,
    clicks: 720,
    cost: 1680.4,
    conversions: 32,
  },
  {
    id: 'demo-2',
    name: 'Grupo Linha Premium & Especialidades',
    campaignId: 'demo-c1',
    campaignName: 'PMax - Vendas & Conversões (Exemplo)',
    adStrength: 'GOOD',
    assetCoverage: 'PARCIAL',
    primaryStatus: 'ELIGIBLE',
    impressions: 11200,
    clicks: 430,
    cost: 1040.1,
    conversions: 18,
  },
  {
    id: 'demo-3',
    name: 'Grupo Institucional & Agendamentos Locais',
    campaignId: 'demo-c2',
    campaignName: 'PMax - Presença Multicanal (Exemplo)',
    adStrength: 'AVERAGE',
    assetCoverage: 'BÁSICA',
    primaryStatus: 'NOT_ELIGIBLE',
    impressions: 4100,
    clicks: 145,
    cost: 490.5,
    conversions: 5,
  },
];

const DEMO_ASSETS: PmaxAssetRow[] = [
  { assetGroupId: 'demo-1', campaignId: 'demo-c1', asset: 't1', fieldType: 'HEADLINE', primaryStatus: 'ELIGIBLE', status: 'ENABLED', impressions: 7200, clicks: 310, cost: 720, conversions: 14 },
  { assetGroupId: 'demo-1', campaignId: 'demo-c1', asset: 't2', fieldType: 'LONG_HEADLINE', primaryStatus: 'ELIGIBLE', status: 'ENABLED', impressions: 5100, clicks: 220, cost: 510, conversions: 10 },
  { assetGroupId: 'demo-1', campaignId: 'demo-c1', asset: 'd1', fieldType: 'DESCRIPTION', primaryStatus: 'ELIGIBLE', status: 'ENABLED', impressions: 6400, clicks: 250, cost: 580, conversions: 11 },
  { assetGroupId: 'demo-1', campaignId: 'demo-c1', asset: 'img1', fieldType: 'MARKETING_IMAGE', primaryStatus: 'ELIGIBLE', status: 'ENABLED', impressions: 8400, clicks: 360, cost: 840, conversions: 16 },
  { assetGroupId: 'demo-1', campaignId: 'demo-c1', asset: 'img2', fieldType: 'SQUARE_MARKETING_IMAGE', primaryStatus: 'ELIGIBLE', status: 'ENABLED', impressions: 6200, clicks: 260, cost: 610, conversions: 12 },
  { assetGroupId: 'demo-2', campaignId: 'demo-c1', asset: 'logo1', fieldType: 'LOGO', primaryStatus: 'ELIGIBLE', status: 'ENABLED', impressions: 9800, clicks: 380, cost: 890, conversions: 17 },
  { assetGroupId: 'demo-2', campaignId: 'demo-c1', asset: 'yt1', fieldType: 'YOUTUBE_VIDEO', primaryStatus: 'LIMITED', status: 'ENABLED', impressions: 2400, clicks: 80, cost: 230, conversions: 3 },
  { assetGroupId: 'demo-3', campaignId: 'demo-c2', asset: 'cta1', fieldType: 'CALL_TO_ACTION_SELECTION', primaryStatus: 'ELIGIBLE', status: 'ENABLED', impressions: 4100, clicks: 145, cost: 490, conversions: 5 },
];

@Component({
  selector: 'app-pmax-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, EChart, Icon, PageHeader, RouterLink],
  template: `
    <app-page-header
      group="Operação no Google Ads"
      title="Radar Performance Max"
      subtitle="Supervisione a saúde dos grupos de recursos, força criativa e o desempenho observado no período multicanal."
      [exportData]="exportData()"
    />

    <!-- Faixa quando o modo demonstração está ativo -->
    @if (demoMode()) {
      <div role="status" class="alert alert-info alert-soft flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div class="flex items-center gap-2">
          <app-icon name="sparkles" class="text-info" />
          <span class="text-sm font-medium">
            <strong>Modo Demonstração Interativo:</strong> Exibindo dados simulados para explorar gráficos, força de anúncios e inventário do Radar PMax.
          </span>
        </div>
        <button type="button" class="btn btn-sm btn-outline" (click)="demoMode.set(false)">
          Voltar para a minha conta
        </button>
      </div>
    }

    <!-- Se houver erro de API e não estiver em demo -->
    @if (hasApiError() && !demoMode()) {
      <div class="flex flex-col gap-block">
        <!-- Card Criativo de Erro / Falha de Leitura do Radar -->
        <section class="card card-border bg-base-100 shadow-sm overflow-hidden border-error/30">
          <div class="card-body p-6 sm:p-8">
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <!-- Radar em Alerta Visual -->
              <div class="relative flex size-24 shrink-0 items-center justify-center rounded-2xl border border-error/30 bg-error/10">
                <div class="absolute inset-0 rounded-2xl border border-error/40 animate-ping opacity-25"></div>
                <div class="absolute inset-2 rounded-xl border border-error/20"></div>
                <app-icon name="warning" class="text-error size-10 relative z-10" />
              </div>

              <div class="flex-1 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="badge badge-error badge-soft gap-1.5 font-medium">
                    <span class="size-2 rounded-full bg-error animate-pulse"></span>
                    Radar Google Ads Offline
                  </span>
                  <span class="badge badge-ghost text-xs">Conta {{ accountName() || 'Ativa' }}</span>
                </div>
                <h2 class="text-xl font-bold text-base-content sm:text-2xl">
                  Não foi possível ler dados de Performance Max
                </h2>
                <p class="text-sm text-base-content/70 leading-relaxed max-w-2xl">
                  O Google Ads não processou a consulta de grupos de recursos. Isso é normal se esta conta nunca criou campanhas PMax, se a conta opera exclusivamente com Pesquisa/Display, ou se o token precisa de renovação.
                </p>
              </div>
            </div>

            <!-- Fallback Reassegurador -->
            <div class="mt-6 rounded-box bg-base-200/60 p-4 border border-base-300/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="flex items-center gap-2.5 text-xs text-base-content/80">
                <app-icon name="shield" class="text-success" />
                <span><strong>Suas outras ferramentas continuam operacionais:</strong> Pesquisa, Negativas, Desperdício e Visão Geral funcionam normalmente.</span>
              </div>
              <div class="text-xs text-base-content/60">Fonte: Diagnóstico da API Google Ads</div>
            </div>

            <!-- Detalhes Técnicos Dobráveis -->
            @if (errorMessage(); as msg) {
              <details class="collapse collapse-arrow bg-base-200/40 border border-base-300 mt-4 rounded-box">
                <summary class="collapse-title text-xs font-medium text-base-content/70 py-3 min-h-0">
                  Ver detalhes técnicos da resposta da API
                </summary>
                <div class="collapse-content text-xs font-mono bg-base-300/30 p-3 rounded-b-box text-base-content/80 break-words">
                  {{ msg }}
                </div>
              </details>
            }

            <!-- Ações Criativas e Fallbacks -->
            <div class="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-base-200">
              <button type="button" class="btn btn-primary btn-sm gap-2" (click)="reload()">
                <app-icon name="refresh" />
                Tentar novamente
              </button>
              <button type="button" class="btn btn-outline btn-sm gap-2" (click)="demoMode.set(true)">
                <app-icon name="sparkles" />
                Explorar Demonstração Interativa
              </button>
              <a routerLink="/operations/campaigns" class="btn btn-ghost btn-sm gap-2">
                <app-icon name="folder" />
                Ver Campanhas da Conta
              </a>
              <a routerLink="/overview" class="btn btn-ghost btn-sm gap-2">
                <app-icon name="home" />
                Ir para a Visão Geral
              </a>
            </div>
          </div>
        </section>
      </div>
    }

    <!-- Se não há grupos PMax e não há erro de API (ou se o usuário não usa PMax) -->
    @else if (!hasAnyGroups() && !demoMode()) {
      <div class="flex flex-col gap-block">
        <!-- Card Criativo Hero: Conta Sem PMax -->
        <section class="card card-border bg-base-100 shadow-sm overflow-hidden">
          <div class="card-body p-6 sm:p-10">
            <div class="flex flex-col md:flex-row items-start md:items-center gap-8">
              <!-- Radar Visual Holográfico com Animação -->
              <div class="relative flex size-28 shrink-0 items-center justify-center rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/10 via-base-100 to-base-200 p-3 shadow-inner">
                <div class="absolute inset-0 rounded-3xl border border-primary/20 animate-ping opacity-20"></div>
                <div class="absolute inset-3 rounded-2xl border border-primary/30"></div>
                <div class="absolute inset-6 rounded-xl border border-dashed border-primary/40 animate-[spin_12s_linear_infinite]"></div>
                <div class="relative z-10 flex flex-col items-center">
                  <app-icon name="target" class="text-primary size-10" />
                  <span class="text-[9px] font-bold tracking-widest uppercase text-primary/80 mt-1">PMAX</span>
                </div>
              </div>

              <div class="flex-1 space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="badge badge-info badge-soft gap-1.5 font-medium">
                    <span class="size-2 rounded-full bg-info"></span>
                    Sem campanhas PMax ativas
                  </span>
                  <span class="badge badge-ghost text-xs">Conta {{ accountName() || 'Ativa' }}</span>
                </div>
                <h2 class="text-2xl font-bold text-base-content sm:text-3xl tracking-tight">
                  Sua conta investe em formatos focados
                </h2>
                <p class="text-sm text-base-content/75 leading-relaxed max-w-2xl">
                  Não encontramos campanhas Performance Max com investimento no período selecionado. O Radar PMax é ativado automaticamente assim que você publicar ou ativar campanhas desse tipo no Google Ads.
                </p>

                <!-- Botões de Ação do Hero -->
                <div class="flex flex-wrap items-center gap-3 pt-2">
                  <button type="button" class="btn btn-primary gap-2" (click)="demoMode.set(true)">
                    <app-icon name="sparkles" />
                    Explorar Demonstração do Radar PMax
                  </button>
                  <a routerLink="/operations/campaigns" class="btn btn-outline gap-2">
                    <app-icon name="folder" />
                    Ver Campanhas da Conta
                  </a>
                  <a routerLink="/overview" class="btn btn-ghost gap-2">
                    <app-icon name="home" />
                    Visão Geral
                  </a>
                </div>
              </div>
            </div>

            <!-- Panorama Real da Conta no Período -->
            <div class="mt-8 pt-6 border-t border-base-200">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-semibold text-base-content/80 flex items-center gap-2">
                  <app-icon name="chart" size="sm" class="text-primary" />
                  Onde está concentrado o seu investimento no período (Google Ads):
                </h3>
                <span class="text-xs text-base-content/50">Fonte: Google Ads</span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div class="card card-border bg-base-200/40 p-4">
                  <div class="text-xs text-base-content/60 font-medium">Campanhas Tradicionais</div>
                  <div class="text-2xl font-bold mt-1 text-base-content">
                    {{ searchCampaigns().length }} <span class="text-sm font-normal text-base-content/60">Pesquisa</span>
                    @if (displayCampaigns().length > 0) {
                      · {{ displayCampaigns().length }} <span class="text-sm font-normal text-base-content/60">Display</span>
                    }
                  </div>
                  <div class="text-xs text-base-content/60 mt-1">Controle direto de palavras e anúncios</div>
                </div>

                <div class="card card-border bg-base-200/40 p-4">
                  <div class="text-xs text-base-content/60 font-medium">Investimento no Período</div>
                  <div class="text-2xl font-bold mt-1 text-base-content">
                    {{ otherCampaignsCost() | currency: 'BRL' : 'symbol' : '1.0-0' }}
                  </div>
                  <div class="text-xs text-base-content/60 mt-1">Alocado nas campanhas ativas</div>
                </div>

                <div class="card card-border bg-base-200/40 p-4">
                  <div class="text-xs text-base-content/60 font-medium">Conversões no Período</div>
                  <div class="text-2xl font-bold mt-1 text-base-content">
                    {{ otherCampaignsConversions() | number: '1.0-1' }}
                  </div>
                  <div class="text-xs text-base-content/60 mt-1">Registradas pelas tags de conversão</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Guia Estratégico Criativo: Quando vale a pena criar PMax? -->
        <section class="card card-border bg-base-100 shadow-sm">
          <div class="card-body p-6 sm:p-8 space-y-6">
            <div>
              <div class="flex items-center gap-2">
                <span class="badge badge-primary badge-soft text-xs font-semibold">Guia Estratégico</span>
                <span class="text-xs text-base-content/50">Boas Práticas Google Ads</span>
              </div>
              <h3 class="text-lg font-bold text-base-content mt-1">
                Quando faz sentido testar uma campanha Performance Max?
              </h3>
              <p class="text-sm text-base-content/70">
                PMax substitui campanhas Smart e de Display tradicionais unificando canais. Avalie se o seu negócio está pronto:
              </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div class="flex flex-col gap-2 rounded-box bg-base-200/50 p-5 border border-base-300/50">
                <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <app-icon name="globe" size="sm" />
                </div>
                <h4 class="font-semibold text-base">1. Presença Multicanal por IA</h4>
                <p class="text-xs text-base-content/70 leading-relaxed">
                  Uma única campanha roda simultaneamente em <strong>Pesquisa, YouTube, Gmail, Maps e Discover</strong>. O algoritmo decide o melhor formato e momento para exibir seu anúncio.
                </p>
              </div>

              <div class="flex flex-col gap-2 rounded-box bg-base-200/50 p-5 border border-base-300/50">
                <div class="flex size-9 items-center justify-center rounded-lg bg-success/10 text-success">
                  <app-icon name="trend-up" size="sm" />
                </div>
                <h4 class="font-semibold text-base">2. Maturidade de Conversões</h4>
                <p class="text-xs text-base-content/70 leading-relaxed">
                  Recomendado para contas que já somam <strong>ao menos 30 conversões no mês</strong> na Pesquisa. O Smart Bidding do PMax necessita de volume de dados para encontrar clientes qualificados.
                </p>
              </div>

              <div class="flex flex-col gap-2 rounded-box bg-base-200/50 p-5 border border-base-300/50">
                <div class="flex size-9 items-center justify-center rounded-lg bg-warning/10 text-warning">
                  <app-icon name="sparkles" size="sm" />
                </div>
                <h4 class="font-semibold text-base">3. Diversidade de Criativos</h4>
                <p class="text-xs text-base-content/70 leading-relaxed">
                  Para atingir força de anúncio <strong>Excelente</strong>, prepare pelo menos 5 títulos, 5 descrições, fotos horizontais (1.91:1), quadradas (1:1), verticais (4:5) e vídeos curtos.
                </p>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-base-200 text-xs text-base-content/70">
              <div class="flex items-center gap-2">
                <app-icon name="light-bulb" class="text-warning" />
                <span>Quer testar antes sem arriscar orçamento? Crie primeiro uma hipótese no Laboratório.</span>
              </div>
              <a routerLink="/actions/lab" class="btn btn-outline btn-xs gap-1.5">
                <app-icon name="beaker" size="xs" />
                Abrir Laboratório de Testes
              </a>
            </div>
          </div>
        </section>
      </div>
    }

    <!-- Visualização Completa do Radar PMax (com dados reais ou com dados da demonstração) -->
    @else {
      <div class="flex flex-col gap-block">
        <!-- Indicadores Chave -->
        <div class="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal shadow-sm">
          <div class="stat">
            <div class="stat-title">Grupos de recursos</div>
            <div class="stat-value text-2xl">{{ groups().length }}</div>
            <div class="stat-desc">em {{ campaignCount() }} {{ campaignCount() === 1 ? 'campanha' : 'campanhas' }}</div>
          </div>
          <div class="stat">
            <div class="stat-title">Recursos com status limitado</div>
            <div class="stat-value text-2xl text-warning">{{ limitedAssets() }}</div>
            <div class="stat-desc">verifique política ou elegibilidade</div>
          </div>
          <div class="stat">
            <div class="stat-title">Investimento observado</div>
            <div class="stat-value text-2xl">{{ totalCost() | currency: 'BRL' : 'symbol' : '1.0-0' }}</div>
            <div class="stat-desc">período selecionado</div>
          </div>
          <div class="stat">
            <div class="stat-title">Conversões observadas</div>
            <div class="stat-value text-2xl">{{ totalConversions() | number: '1.0-1' }}</div>
            <div class="stat-desc">
              @if (totalConversions() > 0) {
                CPA médio {{ totalCost() / totalConversions() | currency: 'BRL' : 'symbol' : '1.2-2' }}
              } @else {
                sem conversões no período
              }
            </div>
          </div>
        </div>

        <!-- Gráfico de Performance por Grupo -->
        @if (groupPerformanceChart(); as chart) {
          <section class="card card-border bg-base-100 shadow-sm">
            <div class="card-body gap-3 p-4 sm:p-6">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-base font-semibold">Investimento e conversões por grupo de recursos</h2>
                  <p class="text-sm text-base-content/70">Métricas observadas no período selecionado, ordenadas por investimento.</p>
                </div>
                <span class="text-xs text-base-content/50">Fonte: {{ dataSourceLabel() }}</span>
              </div>
              <app-echart [option]="chart" [height]="300" label="Custo e conversões observados por grupo de recursos Performance Max" />
            </div>
          </section>
        }

        <!-- Gráfico de Composição do Inventário de Recursos -->
        @if (assetCompositionChart(); as chart) {
          <section class="card card-border bg-base-100 shadow-sm">
            <div class="card-body gap-3 p-4 sm:p-6">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-base font-semibold">Cobertura por tipo de recurso criativo</h2>
                  <p class="text-sm text-base-content/70">Contagem do inventário lido. Recursos limitados indicam peças com restrições de política ou formato.</p>
                </div>
                <span class="text-xs text-base-content/50">Fonte: {{ dataSourceLabel() }}</span>
              </div>
              <app-echart [option]="chart" [height]="280" label="Recursos e recursos limitados por tipo em Performance Max" />
            </div>
          </section>
        }

        <!-- Tabela de Grupos de Recursos -->
        <section class="card card-border bg-base-100 shadow-sm">
          <div class="card-body gap-4 p-4 sm:p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold">Grupos de recursos</h2>
                <p class="text-sm text-base-content/70">Força do anúncio e status vêm do Google Ads; custo e conversões são do período.</p>
              </div>
              <span class="text-xs text-base-content/50">Fonte: {{ dataSourceLabel() }}</span>
            </div>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Campanha / grupo</th>
                    <th>Força</th>
                    <th>Status</th>
                    <th class="text-right">Custo</th>
                    <th class="text-right">Conv.</th>
                    <th class="text-right">CPA observado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (g of groups(); track g.id) {
                    <tr class="hover:bg-base-200/60">
                      <td>
                        <div class="font-medium">{{ g.name || 'Grupo sem nome' }}</div>
                        <div class="text-xs text-base-content/60">{{ g.campaignName }}</div>
                      </td>
                      <td>
                        <span [class]="strengthClass(g.adStrength)">{{ strengthLabel(g.adStrength) }}</span>
                      </td>
                      <td class="text-sm">{{ g.primaryStatus || 'Não informado' }}</td>
                      <td class="tabular text-right">{{ g.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                      <td class="tabular text-right">{{ g.conversions | number: '1.0-1' }}</td>
                      <td class="tabular text-right">
                        @if (g.conversions > 0) {
                          {{ g.cost / g.conversions | currency: 'BRL' : 'symbol' : '1.2-2' }}
                        } @else {
                          —
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Tabela de Composição dos Recursos -->
        <section class="card card-border bg-base-100 shadow-sm">
          <div class="card-body gap-4 p-4 sm:p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold">Composição dos recursos criativos</h2>
                <p class="text-sm text-base-content/70">Inventário agrupado por tipo de ativo (títulos, imagens, vídeos, chamadas).</p>
              </div>
              <span class="text-xs text-base-content/50">Fonte: {{ dataSourceLabel() }}</span>
            </div>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th class="text-right">Recursos</th>
                    <th class="text-right">Limitados</th>
                    <th class="text-right">Impressões</th>
                    <th class="text-right">Cliques</th>
                    <th class="text-right">Custo observado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of assetSummary(); track row.fieldType) {
                    <tr class="hover:bg-base-200/60">
                      <td class="font-medium">{{ fieldLabel(row.fieldType) }}</td>
                      <td class="tabular text-right">{{ row.count }}</td>
                      <td class="tabular text-right">
                        @if (row.limited > 0) {
                          <span class="badge badge-warning badge-soft badge-sm">{{ row.limited }}</span>
                        } @else {
                          0
                        }
                      </td>
                      <td class="tabular text-right">{{ row.impressions | number: '1.0-0' }}</td>
                      <td class="tabular text-right">{{ row.clicks | number: '1.0-0' }}</td>
                      <td class="tabular text-right">{{ row.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div role="note" class="alert alert-soft text-sm">
          <app-icon name="info" />
          <span>Para otimizar recursos, orçamento ou lances, planeje uma hipótese no Laboratório antes de alterar. Este radar é somente leitura.</span>
        </div>
      </div>
    }
  `,
})
export class PmaxPage {
  protected readonly ws = inject(Workspace);
  protected readonly demoMode = signal(false);

  // Dados reais
  private readonly rawGroups = computed(() => this.ws.pmaxAssetGroups.value() ?? []);
  private readonly rawAssets = computed(() => this.ws.pmaxAssets.value() ?? []);

  // Dados ativos (reais ou simulados)
  protected readonly groups = computed(() => {
    if (this.demoMode()) return [...DEMO_GROUPS].sort((a, b) => b.cost - a.cost);
    return [...this.rawGroups()].sort((a, b) => b.cost - a.cost);
  });

  private readonly assets = computed(() => {
    if (this.demoMode()) return DEMO_ASSETS;
    return this.rawAssets();
  });

  // Campanhas gerais da conta para contexto de fallback
  protected readonly allCampaigns = computed(() => this.ws.campaigns.value() ?? []);
  protected readonly searchCampaigns = computed(() => this.allCampaigns().filter((c) => c.channel === 'SEARCH'));
  protected readonly displayCampaigns = computed(() => this.allCampaigns().filter((c) => c.channel === 'DISPLAY'));
  protected readonly otherCampaignsCost = computed(() =>
    this.allCampaigns()
      .filter((c) => c.channel !== 'PERFORMANCE_MAX')
      .reduce((s, c) => s + c.cost, 0),
  );
  protected readonly otherCampaignsConversions = computed(() =>
    this.allCampaigns()
      .filter((c) => c.channel !== 'PERFORMANCE_MAX')
      .reduce((s, c) => s + c.conversions, 0),
  );
  protected readonly accountName = computed(() => this.ws.accountName());

  // Status de disponibilidade
  protected readonly hasApiError = computed(() => Boolean(this.ws.pmaxAssetGroups.error() || this.ws.pmaxAssets.error()));
  protected readonly errorMessage = computed(() => this.ws.pmaxAssetGroups.error() ?? this.ws.pmaxAssets.error() ?? '');
  protected readonly hasAnyGroups = computed(() => this.groups().length > 0);

  protected readonly campaignCount = computed(() => new Set(this.groups().map((g) => g.campaignId)).size);
  protected readonly totalCost = computed(() => this.groups().reduce((sum, g) => sum + g.cost, 0));
  protected readonly totalConversions = computed(() => this.groups().reduce((sum, g) => sum + g.conversions, 0));

  protected readonly dataSourceLabel = computed(() =>
    this.demoMode() ? 'Simulação demonstrativa (exemplo)' : 'Google Ads',
  );

  protected readonly assetSummary = computed<AssetSummary[]>(() => {
    const byType = new Map<string, AssetSummary>();
    for (const row of this.assets()) {
      const current = byType.get(row.fieldType) ?? {
        fieldType: row.fieldType,
        count: 0,
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        limited: 0,
      };
      current.count++;
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      current.cost += row.cost;
      current.conversions += row.conversions;
      if (row.primaryStatus && row.primaryStatus !== 'ELIGIBLE') current.limited++;
      byType.set(row.fieldType, current);
    }
    return [...byType.values()].sort((a, b) => b.cost - a.cost || a.fieldType.localeCompare(b.fieldType));
  });

  protected readonly limitedAssets = computed(() => this.assetSummary().reduce((sum, item) => sum + item.limited, 0));

  protected readonly groupPerformanceChart = computed<EChartsCoreOption | null>(() => {
    const rows = this.groups().slice(0, 12).reverse();
    if (!rows.length) return null;
    return {
      color: ['#f1a10b', '#3d7ea6'],
      grid: { left: 64, right: 56, top: 36, bottom: 76, outerBounds: true },
      legend: { data: ['Custo observado', 'Conversões observadas'] },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: rows.map((g) => g.name || g.campaignName),
        axisLabel: { rotate: 28, interval: 0 },
      },
      yAxis: [
        { type: 'value', name: 'Custo (R$)', axisLabel: { formatter: (value: number) => `R$ ${Math.round(value)}` } },
        { type: 'value', name: 'Conversões', minInterval: 1 },
      ],
      series: [
        { type: 'bar', name: 'Custo observado', data: rows.map((g) => Math.round(g.cost * 100) / 100), barMaxWidth: 32 },
        { type: 'line', name: 'Conversões observadas', yAxisIndex: 1, data: rows.map((g) => Math.round(g.conversions * 10) / 10), smooth: true },
      ],
    };
  });

  protected readonly assetCompositionChart = computed<EChartsCoreOption | null>(() => {
    const rows = this.assetSummary().slice(0, 10).reverse();
    if (!rows.length) return null;
    return {
      color: ['#3d7ea6', '#c0392b'],
      grid: { left: 136, right: 24, top: 36, bottom: 24, outerBounds: true },
      legend: { data: ['Recursos', 'Limitados'] },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: rows.map((row) => fieldLabel(row.fieldType)) },
      series: [
        { type: 'bar', name: 'Recursos', data: rows.map((row) => row.count), barMaxWidth: 24 },
        { type: 'bar', name: 'Limitados', data: rows.map((row) => row.limited), barMaxWidth: 24 },
      ],
    };
  });

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'radar-performance-max',
    rows: this.groups().map((g) => ({
      Campanha: g.campaignName,
      Grupo: g.name,
      'Força do anúncio': strengthLabel(g.adStrength),
      Status: g.primaryStatus,
      'Custo (R$)': Math.round(g.cost * 100) / 100,
      Conversões: g.conversions,
    })),
  }));

  constructor() {
    this.ws.campaigns.need();
    this.ws.pmaxAssetGroups.need();
    this.ws.pmaxAssets.need();
  }

  protected strengthLabel = strengthLabel;
  protected strengthClass = strengthClass;
  protected fieldLabel = fieldLabel;

  protected reload(): void {
    this.ws.pmaxAssetGroups.reload();
    this.ws.pmaxAssets.reload();
  }
}
