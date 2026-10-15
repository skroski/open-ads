import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, min, required } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { AdsActions } from '../../core/ads-actions';
import { AccountStore } from '../../core/account.store';
import { PageAudits } from '../../core/page-audits';
import { GoogleAdsApi, KeywordIdeasResult } from '../../data/google-ads.api';
import { Insights } from '../../core/insights';
import { ToastService } from '../../core/toast.service';
import { Workspace } from '../../core/workspace';
import { AdGroupFit } from '../../domain/keyword-fit';
import { KeywordSuggestion, SuggestionSource } from '../../domain/keyword-suggest';
import { KeywordCategory, KeywordQuality, KeywordRow, MatchType, QualityRating } from '../../domain/models';
import { DataState } from '../../shared/data-state';
import { Icon } from '../../shared/icon';
import { KEYWORD_CATEGORY_CLASS, KEYWORD_CATEGORY_LABEL, MATCH_CLASS, MATCH_LABEL, formatMatch } from '../../shared/labels';
import { AppModal } from '../../shared/modal';
import { ExportData, PageHeader } from '../../shared/page-header';

const BRAND_BID_CAP = 0.1;
const PAGE_SIZE = 100;

@Component({
  selector: 'app-keywords-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DecimalPipe, PercentPipe, AppModal, DataState, FormField, FormRoot, Icon, PageHeader],
  template: `
    <app-page-header
      group="Operação no Google Ads"
      title="Palavras-chave"
      subtitle="Pause, limite o teto de CPC ou exclua palavras direto na conta. Cada mudança é registrada no histórico para medir o efeito depois."
      [exportData]="exportData()"
    />

    <app-data-state
      [loading]="ws.keywordsBase.loading()"
      [error]="ws.keywordsBase.error()"
      [hasData]="!!ws.keywordsBase.value()"
      (retry)="ws.keywordsBase.reload()"
    >
      <div class="flex flex-col gap-block">
        <div class="stats stats-vertical w-full border border-base-300 bg-base-100 md:stats-horizontal">
          <div class="stat">
            <div class="stat-title">Palavras de marca ativas</div>
            <div class="stat-value">{{ summary().brand.count }}</div>
            <div class="stat-desc">
              {{ summary().brand.impressions | number: '1.0-0' }} impr. · {{ summary().brand.clicks | number: '1.0-0' }} cliques · {{ summary().brand.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}
              @if (summary().brand.cpc > 0) {
                · CPC {{ summary().brand.cpc | currency: 'BRL' : 'symbol' : '1.2-2' }}
              }
            </div>
          </div>
          <div class="stat">
            <div class="stat-title">Com risco de desperdício</div>
            <div class="stat-value">{{ summary().risk.count }}</div>
            <div class="stat-desc">
              {{ summary().risk.cost | currency: 'BRL' : 'symbol' : '1.2-2' }} no período · contêm termos da sua lista de desqualificados
            </div>
          </div>
          <div class="stat">
            <div class="stat-title">Ativas / total</div>
            <div class="stat-value">{{ summary().active }} / {{ keywords().length }}</div>
            <div class="stat-desc">
              {{ summary().impressions | number: '1.0-0' }} impr. · {{ summary().clicks | number: '1.0-0' }} cliques · Custo {{ summary().cost | currency: 'BRL' : 'symbol' : '1.2-2' }}
            </div>
          </div>
        </div>

        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
             <div>
              <h2 class="card-title text-base"><app-icon name="link" size="sm" /> Palavra-chave × página de destino</h2>
              <p class="text-sm text-base-content/70">
                O Índice de Qualidade do Google pesa a experiência na página: quem busca um assunto e cai numa
                página sobre outro volta para trás, e o clique fica mais caro. Aqui cada grupo de anúncios mostra a
                página usada, quanto as palavras dele aparecem nela e a nota que o próprio Google dá.
              </p>
             </div>
              @if (unreadPages().length) {
                <button type="button" class="btn btn-sm flex-none" [disabled]="reading()" (click)="readPages()">
                  @if (reading()) {
                    <span class="loading loading-spinner loading-xs"></span>
                  } @else {
                    <app-icon name="eye" size="xs" />
                  }
                  Ler as {{ unreadPages().length }} páginas
                </button>
              }
            </div>

            @if (!fits().length) {
              <p class="text-sm text-base-content/60">Nenhuma palavra-chave ativa para avaliar.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Campanha / grupo</th>
                      <th>Página usada</th>
                      <th class="text-right">Aderência</th>
                      <th class="text-right">IQ médio</th>
                      <th>Página (nota Google)</th>
                      <th>Palavras fora da página</th>
                      <th>Sugestão</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (g of visibleFits(); track g.adGroupId) {
                      <tr class="align-top hover:bg-base-200/60">
                        <td class="max-w-52">
                          <div class="truncate" [attr.title]="g.campaignName">{{ g.campaignName }}</div>
                          <div class="truncate text-xs text-base-content/60" [attr.title]="g.adGroupName">
                            {{ g.adGroupName }} · {{ g.keywords }} palavras
                          </div>
                        </td>
                        <td class="max-w-60">
                          @if (g.url) {
                            <a class="link link-hover block truncate text-sm" [href]="g.url" target="_blank" rel="noopener" [attr.title]="g.url">
                              {{ path(g.url) }}
                            </a>
                            @if (g.basis !== 'AUDIT') {
                              <div class="text-xs text-base-content/60">Estimado só pelo endereço</div>
                            }
                          } @else {
                            <span class="text-sm text-base-content/50">Sem anúncio ativo</span>
                          }
                        </td>
                        <td class="tabular text-right" [class.text-error]="g.avgFit !== null && g.avgFit < 0.34">
                          {{ g.avgFit === null ? '—' : (g.avgFit | percent: '1.0-0') }}
                        </td>
                        <td class="tabular text-right">{{ g.qualityAvg === null ? '—' : (g.qualityAvg | number: '1.1-1') }}</td>
                        <td class="text-sm">
                          @if (!g.landingRated) {
                            <span class="text-base-content/50">Sem nota ainda</span>
                          } @else if (g.landingBelow) {
                            <span class="badge badge-soft badge-error badge-sm">{{ g.landingBelow }} de {{ g.landingRated }} abaixo da média</span>
                          } @else {
                            <span class="badge badge-soft badge-success badge-sm">Na média ou acima</span>
                          }
                        </td>
                        <td class="max-w-60 text-sm">
                          @for (m of g.misaligned.slice(0, 3); track m.text) {
                            <div class="truncate" [attr.title]="m.text">{{ m.text }} <span class="text-base-content/60">({{ m.fit | percent: '1.0-0' }})</span></div>
                          } @empty {
                            <span class="text-base-content/50">—</span>
                          }
                          @if (g.misaligned.length > 3) {
                            <div class="text-xs text-base-content/60">e mais {{ g.misaligned.length - 3 }}</div>
                          }
                        </td>
                        <td class="max-w-64 text-sm">
                          @if (g.basis !== 'AUDIT' && (g.suggestion?.kind === 'REDIRECT' || g.suggestion?.kind === 'CREATE')) {
                            <span class="text-base-content/60">Leia as páginas para comparar o conteúdo, não só o endereço.</span>
                          } @else {
                          @switch (g.suggestion?.kind) {
                            @case ('REDIRECT') {
                              <div>Trocar para</div>
                              <a class="link link-hover block truncate" [href]="g.suggestion!.best!.url" target="_blank" rel="noopener" [attr.title]="g.suggestion!.best!.url">
                                {{ path(g.suggestion!.best!.url) }}
                              </a>
                            }
                            @case ('CREATE') {
                              <div>Criar uma página sobre</div>
                              <div class="font-medium">“{{ g.suggestion!.suggestedTitle }}”</div>
                            }
                            @case ('KEEP') {
                              @if (g.avgFit !== null && g.avgFit < 0.34) {
                                <span>Nenhuma página conhecida cobre melhor. Ajuste o texto desta para falar das palavras do grupo.</span>
                              } @else {
                                <span class="text-base-content/70">Manter a página atual</span>
                              }
                            }
                            @default {
                              <span class="text-base-content/50">Sem páginas para comparar</span>
                            }
                          }
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (fits().length > visibleFits().length) {
                <div class="flex justify-center">
                  <button type="button" class="btn btn-sm" (click)="allFits.set(true)">
                    Mostrar todos os grupos ({{ fits().length }})
                  </button>
                </div>
              }
            }
          </div>
        </section>

        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 class="card-title text-base"><app-icon name="sparkles" size="sm" /> Sugestões de palavras-chave</h2>
                <p class="text-sm text-base-content/70">
                  Buscas reais que ainda não são palavra-chave: termos que já trouxeram resultado ou cliques
                  repetidos e, com o Search Console ligado, buscas orgânicas do mesmo assunto da campanha.
                </p>
              </div>
              <select
                class="select select-sm w-full md:w-72"
                aria-label="Campanha das sugestões"
                [value]="suggestCampaign()"
                (change)="pickCampaign(val($event))"
              >
                @for (c of suggestCampaigns(); track c.id) {
                  <option [value]="c.id">{{ c.name }} ({{ c.count }})</option>
                }
              </select>
            </div>

            @if (!campaignSuggestions().length) {
              <p class="text-sm text-base-content/60">
                Nenhuma sugestão para esta campanha no período: os termos que trouxeram resultado já são palavras-chave.
              </p>
            } @else {
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Sugestão</th>
                      <th>Origem</th>
                      <th>Por quê</th>
                      <th class="text-right">Cliques</th>
                      <th class="text-right">Conv.</th>
                      <th><span class="sr-only">Copiar</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (sg of campaignSuggestions().slice(0, 25); track sg.source + sg.text) {
                      <tr class="align-top hover:bg-base-200/60">
                        <td class="max-w-64">
                          <div class="font-mono text-sm break-words">{{ fmtText(sg.text, sg.matchType) }}</div>
                          @if (sg.adGroupName) {
                            <div class="text-xs text-base-content/60">Grupo: {{ sg.adGroupName }}</div>
                          }
                        </td>
                        <td><span class="badge badge-soft badge-sm" [class.badge-info]="sg.source === 'SEARCH_CONSOLE'">{{ sourceLabel(sg.source) }}</span></td>
                        <td class="max-w-80 text-sm text-base-content/70">{{ sg.reason }}</td>
                        <td class="tabular text-right">{{ sg.clicks | number: '1.0-0' }}</td>
                        <td class="tabular text-right">{{ sg.conversions | number: '1.0-1' }}</td>
                        <td>
                          <button type="button" class="btn btn-ghost btn-xs" (click)="copy(fmtText(sg.text, sg.matchType))">Copiar</button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs text-base-content/60">
                  Cole no Editor do Google Ads ou na tela do grupo. Termos com conversão vêm em correspondência exata.
                </p>
                <button type="button" class="btn btn-sm" (click)="copyAll()">
                  <app-icon name="copy" size="xs" /> Copiar todas ({{ campaignSuggestions().length }})
                </button>
              </div>
            }

            <div class="divider my-0"></div>

            <div class="flex flex-col gap-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 class="font-medium">Planejador de Palavras-chave do Google</h3>
                  <p class="text-sm text-base-content/70">
                    Usa as palavras e a página desta campanha como semente para buscar volume e concorrência.
                  </p>
                </div>
                <button type="button" class="btn btn-sm" [disabled]="planner.loading()" (click)="loadIdeas()">
                  @if (planner.loading()) {
                    <span class="loading loading-spinner loading-xs"></span>
                  }
                  Buscar ideias
                </button>
              </div>

              @if (planner.result(); as r) {
                @if (r.code === 'DEVELOPER_TOKEN_NOT_APPROVED') {
                  <div role="status" class="alert alert-info alert-soft">
                    <app-icon name="info" />
                    <div class="text-sm">
                      O projeto do Google Cloud desta integração está no acesso <strong>Test ou Explorer</strong>, que não
                      libera o Planejador. Peça o acesso Basic em Google Cloud Console → Google Ads API → Visão geral;
                      quando sair, este botão passa a funcionar sem mudar nada aqui. Enquanto isso, use as sugestões acima.
                    </div>
                  </div>
                } @else if (!r.ideas.length) {
                  <p class="text-sm text-base-content/60">O Google não devolveu ideias para esta semente.</p>
                } @else {
                  <div class="overflow-x-auto">
                    <table class="table table-sm">
                      <thead>
                        <tr>
                          <th>Ideia</th>
                          <th class="text-right">Buscas/mês</th>
                          <th>Concorrência</th>
                          <th class="text-right">Lance topo (faixa)</th>
                          <th><span class="sr-only">Copiar</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (i of newIdeas(); track i.text) {
                          <tr class="hover:bg-base-200/60">
                            <td class="font-medium">{{ i.text }}</td>
                            <td class="tabular text-right">{{ i.avgMonthlySearches | number: '1.0-0' }}</td>
                            <td class="text-sm">{{ competitionLabel(i.competition) }}</td>
                            <td class="tabular text-right text-sm">
                              @if (i.lowBid !== null && i.highBid !== null) {
                                {{ i.lowBid | currency: 'BRL' : 'symbol' : '1.2-2' }} – {{ i.highBid | currency: 'BRL' : 'symbol' : '1.2-2' }}
                              } @else {
                                —
                              }
                            </td>
                            <td><button type="button" class="btn btn-ghost btn-xs" (click)="copy(i.text)">Copiar</button></td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              }
              @if (planner.error(); as err) {
                <div role="alert" class="alert alert-error alert-soft"><app-icon name="warning" /><span class="text-sm">{{ err }}</span></div>
              }
            </div>
          </div>
        </section>

        <section class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div class="flex flex-wrap gap-2">
              <input
                type="search"
                class="input input-sm w-full sm:w-64"
                placeholder="Buscar palavra ou campanha…"
                aria-label="Buscar palavra ou campanha"
                [value]="query()"
                (input)="query.set(val($event))"
              />
              <select class="select select-sm" aria-label="Classificação" [value]="category()" (change)="category.set(val($event))">
                <option value="ALL">Todas as classificações</option>
                <option value="BRAND">Marca</option>
                <option value="RISK">Risco de desperdício</option>
                <option value="QUALIFIED">Qualificada</option>
                <option value="GENERAL">Geral</option>
              </select>
              <div class="join" role="group" aria-label="Filtrar por status">
                @for (f of statusFilters(); track f.value) {
                  <button
                    type="button"
                    class="btn btn-sm join-item"
                    [class.btn-neutral]="status() === f.value"
                    [attr.aria-pressed]="status() === f.value"
                    (click)="status.set(f.value)"
                  >
                    {{ f.label }} <span class="tabular opacity-70">{{ f.count }}</span>
                  </button>
                }
              </div>
              <span class="ml-auto self-center text-sm text-base-content/60 tabular">
                {{ filtered().length }} palavras
              </span>
            </div>

            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Palavra</th>
                    <th>Classificação</th>
                    <th>Campanha / grupo</th>
                    <th class="text-right">Impressões</th>
                    <th class="text-right">Cliques</th>
                    <th class="text-right">CTR</th>
                    <th class="text-right">Custo</th>
                    <th class="text-right">Conv.</th>
                    <th class="text-right">IQ</th>
                    <th>Teto de CPC</th>
                    <th>Status</th>
                    <th><span class="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (kw of visible(); track kw.resourceName) {
                    <tr class="hover:bg-base-200/60">
                      <td class="max-w-64">
                        <div class="font-medium break-words">{{ fmt(kw) }}</div>
                        <span [class]="matchClass(kw.matchType)">{{ matchLabel(kw.matchType) }}</span>
                      </td>
                      <td>
                        <span [class]="catClass(kw.category)" [attr.title]="kw.categoryReason">{{ catLabel(kw.category) }}</span>
                      </td>
                      <td class="max-w-56">
                        <div class="truncate" [attr.title]="kw.campaignName">{{ kw.campaignName }}</div>
                        <div class="truncate text-xs text-base-content/60" [attr.title]="kw.adGroupName">{{ kw.adGroupName }}</div>
                      </td>
                      <td class="text-right tabular">{{ kw.impressions | number: '1.0-0' }}</td>
                      <td class="text-right tabular">{{ kw.clicks | number: '1.0-0' }}</td>
                      <td class="text-right tabular text-base-content/70">
                        {{ (kw.impressions > 0 ? kw.clicks / kw.impressions : 0) | percent: '1.1-1' }}
                      </td>
                      <td class="text-right tabular font-semibold">{{ kw.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                      <td class="text-right tabular">{{ kw.conversions | number: '1.0-1' }}</td>
                      <td class="text-right">
                        @if (kw.quality?.score; as qs) {
                          <span [class]="qsClass(qs)" [attr.title]="qsDetail(kw.quality!)">{{ qs }}/10</span>
                        } @else {
                          <span class="text-xs text-base-content/50" title="O Google ainda não tem volume para dar nota">—</span>
                        }
                      </td>
                      <td class="whitespace-nowrap">
                        @if (kw.bid) {
                          <span class="badge badge-soft badge-secondary tabular">{{ kw.bid | currency: 'BRL' : 'symbol' : '1.2-2' }}</span>
                        } @else {
                          <span class="text-xs text-base-content/50">Do grupo</span>
                        }
                        <button type="button" class="btn btn-ghost btn-xs btn-square" aria-label="Editar teto de CPC" title="Editar teto de CPC" (click)="openBid(kw)">
                          <app-icon name="pencil" size="xs" />
                        </button>
                        @if (kw.category === 'BRAND' && (!kw.bid || kw.bid > brandCap)) {
                          <button
                            type="button"
                            class="btn btn-xs"
                            [disabled]="actions.busyResource() === kw.resourceName"
                            title="Limitar o CPC desta palavra de marca a R$ 0,10"
                            (click)="capBrand(kw)"
                          >
                            <app-icon name="bolt" size="xs" /> R$ 0,10
                          </button>
                        }
                      </td>
                      <td>
                        <span class="inline-flex items-center gap-2 text-xs">
                          <span class="status" [class.status-success]="kw.status === 'ENABLED'" [class.status-neutral]="kw.status !== 'ENABLED'"></span>
                          {{ kw.status === 'ENABLED' ? 'Ativa' : 'Pausada' }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap">
                        <button
                          type="button"
                          class="btn btn-xs"
                          [disabled]="actions.busyResource() === kw.resourceName"
                          (click)="toggle(kw)"
                        >
                          @if (actions.busyResource() === kw.resourceName) {
                            <span class="loading loading-spinner loading-xs"></span>
                          } @else if (kw.status === 'ENABLED') {
                            <app-icon name="pause" size="xs" /> Pausar
                          } @else {
                            <app-icon name="play" size="xs" /> Reativar
                          }
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs btn-square text-error"
                          aria-label="Excluir palavra"
                          title="Excluir definitivamente"
                          (click)="askDelete(kw)"
                        >
                          <app-icon name="trash" size="xs" />
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="12" class="py-12 text-center text-base-content/60">
                        Nenhuma palavra encontrada com os filtros atuais.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            @if (filtered().length > shown()) {
              <div class="flex justify-center">
                <button type="button" class="btn btn-sm" (click)="shown.set(shown() + pageSize)">
                  Mostrar mais ({{ filtered().length - shown() }} restantes)
                </button>
              </div>
            }
          </div>
        </section>
      </div>
    </app-data-state>

    <!-- Teto de CPC -->
    <app-modal [(open)]="bidOpen" size="md">
      @if (bidTarget(); as kw) {
        <h3 class="flex items-center gap-2 text-lg font-semibold">
          <app-icon name="currency" /> Teto de CPC
        </h3>
        <p class="mt-1 text-sm text-base-content/70">
          Limita quanto o Google pode cobrar por clique em <strong class="font-mono">{{ fmt(kw) }}</strong>
          ({{ kw.campaignName }}).
        </p>

        <form [formRoot]="bidForm" class="mt-4 flex flex-col gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Teto em reais (R$)</legend>
            <input type="number" step="0.05" class="input w-full font-mono" [formField]="bidForm.amount" />
            @if (bidForm.amount().touched() && bidForm.amount().errors().length) {
              <p class="label text-error">{{ bidForm.amount().errors()[0].message }}</p>
            }
          </fieldset>
          <div class="flex flex-wrap gap-2">
            @for (v of bidShortcuts; track v) {
              <button type="button" class="btn btn-xs font-mono" (click)="setBid(v)">
                {{ v | currency: 'BRL' : 'symbol' : '1.2-2' }}
              </button>
            }
          </div>
          <p class="text-xs text-base-content/70">
            Com um teto baixo, o anúncio deixa de entrar em leilões caros. Em contrapartida, o volume de cliques
            pode cair. Confira o efeito na tela de histórico depois de alguns dias.
          </p>
          <div class="modal-action">
            <button type="button" class="btn btn-ghost" (click)="bidOpen.set(false)">Cancelar</button>
            <button type="submit" class="btn btn-primary" [disabled]="actions.busyResource() === kw.resourceName">
              @if (actions.busyResource() === kw.resourceName) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Salvar teto
            </button>
          </div>
        </form>
      }
    </app-modal>

    <!-- Exclusão -->
    <app-modal [(open)]="deleteOpen" size="sm">
      @if (deleteTarget(); as kw) {
        <h3 class="flex items-center gap-2 text-lg font-semibold text-error">
          <app-icon name="trash" /> Excluir palavra-chave?
        </h3>
        <p class="mt-2 text-sm">
          <strong class="font-mono">{{ fmt(kw) }}</strong> será removida definitivamente do grupo
          “{{ kw.adGroupName }}”. Ela deixa de participar de qualquer leilão.
        </p>
        <p class="mt-2 text-sm text-base-content/70">
          Se a ideia é só parar de gastar por um tempo, prefira <em>Pausar</em>: dá para reativar depois.
        </p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" (click)="deleteOpen.set(false)">Cancelar</button>
          <button
            type="button"
            class="btn btn-error"
            [disabled]="actions.busyResource() === kw.resourceName"
            (click)="confirmDelete(kw)"
          >
            @if (actions.busyResource() === kw.resourceName) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Sim, excluir
          </button>
        </div>
      }
    </app-modal>
  `,
})
export class KeywordsPage {
  protected readonly ws = inject(Workspace);
  private readonly insights = inject(Insights);
  protected readonly actions = inject(AdsActions);
  private readonly toast = inject(ToastService);

  protected readonly brandCap = BRAND_BID_CAP;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly bidShortcuts = [0.1, 0.2, 0.5, 1];

  protected readonly keywords = this.ws.keywords;
  protected readonly fits = this.insights.keywordFits;

  private readonly api = inject(GoogleAdsApi);
  private readonly account = inject(AccountStore);
  private readonly suggestions = this.insights.keywordSuggestions;
  private readonly chosenCampaign = signal<string | null>(null);

  /** Campanhas que têm palavras-chave, com quantas sugestões cada uma tem. */
  protected readonly suggestCampaigns = computed(() => {
    const counts = new Map<string, number>();
    for (const sg of this.suggestions()) counts.set(sg.campaignId, (counts.get(sg.campaignId) ?? 0) + 1);
    const names = new Map(this.keywords().map((k) => [k.campaignId, k.campaignName]));
    return [...names]
      .map(([id, name]) => ({ id, name, count: counts.get(id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
  });
  protected readonly suggestCampaign = computed(() => this.chosenCampaign() ?? this.suggestCampaigns()[0]?.id ?? '');
  protected readonly campaignSuggestions = computed<KeywordSuggestion[]>(() =>
    this.suggestions().filter((sg) => sg.campaignId === this.suggestCampaign()),
  );

  protected readonly planner = {
    loading: signal(false),
    result: signal<KeywordIdeasResult | null>(null),
    error: signal<string | null>(null),
  };
  /** Ideias do Planejador que ainda não são palavra-chave em lugar nenhum da conta. */
  protected readonly newIdeas = computed(() => {
    const existing = new Set(this.keywords().map((k) => k.text.replace(/[[\]"+]/g, '').toLowerCase().trim()));
    return (this.planner.result()?.ideas ?? []).filter((i) => !existing.has(i.text.toLowerCase().trim())).slice(0, 30);
  });
  protected readonly allFits = signal(false);
  private readonly audits = inject(PageAudits);
  protected readonly reading = signal(false);
  /** Páginas usadas pelos grupos (e sugeridas) que ainda não foram lidas. */
  protected readonly unreadPages = computed(() => {
    const urls = this.fits().flatMap((g) => [g.url, g.suggestion?.best?.url]).filter((u): u is string => !!u);
    return [...new Set(urls)].filter((u) => !this.audits.get(u)?.ok);
  });

  protected async readPages(): Promise<void> {
    this.reading.set(true);
    await this.audits.auditMany(this.unreadPages());
    this.reading.set(false);
    const err = this.audits.lastError();
    if (err) this.toast.warning(`Algumas páginas não puderam ser lidas: ${err}`);
  }
  /** Grupos com problema primeiro; o resto aparece sob demanda. */
  protected readonly visibleFits = computed<AdGroupFit[]>(() => (this.allFits() ? this.fits() : this.fits().slice(0, 8)));
  protected readonly query = signal('');
  protected readonly category = signal<'ALL' | KeywordCategory>('ALL');
  protected readonly status = signal<'ALL' | 'ENABLED' | 'PAUSED'>('ALL');
  protected readonly statusFilters = computed(() => {
    const all = this.keywords();
    return [
      { value: 'ALL' as const, label: 'Todas', count: all.length },
      { value: 'ENABLED' as const, label: 'Ativas', count: all.filter((k) => k.status === 'ENABLED').length },
      { value: 'PAUSED' as const, label: 'Pausadas', count: all.filter((k) => k.status === 'PAUSED').length },
    ];
  });

  protected readonly exportData = computed<ExportData>(() => ({
    name: 'palavras-chave',
    rows: this.filtered().map((k) => ({
      'Palavra-chave': k.text,
      Correspondência: MATCH_LABEL[k.matchType],
      Campanha: k.campaignName,
      Grupo: k.adGroupName,
      Status: k.status === 'ENABLED' ? 'Ativa' : 'Pausada',
      'Índice de qualidade': k.quality?.score ?? '',
      Impressões: k.impressions,
      Cliques: k.clicks,
      'Custo (R$)': Math.round(k.cost * 100) / 100,
      Conversões: Math.round(k.conversions * 10) / 10,
      'Teto de CPC (R$)': k.bid ?? '',
    })),
  }));
  protected readonly shown = signal(PAGE_SIZE);

  protected readonly bidOpen = signal(false);
  protected readonly bidTarget = signal<KeywordRow | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<KeywordRow | null>(null);

  private readonly bidValue = signal({ amount: BRAND_BID_CAP });
  protected readonly bidForm = form(
    this.bidValue,
    (p) => {
      required(p.amount, { message: 'Informe o valor do teto.' });
      min(p.amount, 0.05, { message: 'O teto mínimo é R$ 0,05.' });
    },
    {
      submission: {
        action: async () => {
          const kw = this.bidTarget();
          if (!kw) return undefined;
          const r = await this.actions.setKeywordBid(kw, this.bidValue().amount);
          if (r.ok) {
            this.toast.success(r.message);
            this.bidOpen.set(false);
          } else {
            this.toast.error(r.message);
          }
          return undefined;
        },
      },
    },
  );

  protected readonly summary = computed(() => {
    const list = this.keywords();
    const agg = (rows: KeywordRow[]) => {
      const cost = rows.reduce((s, k) => s + k.cost, 0);
      const clicks = rows.reduce((s, k) => s + k.clicks, 0);
      const impressions = rows.reduce((s, k) => s + k.impressions, 0);
      return { count: rows.length, cost, clicks, impressions, cpc: clicks > 0 ? cost / clicks : 0 };
    };
    return {
      brand: agg(list.filter((k) => k.category === 'BRAND' && k.status === 'ENABLED')),
      risk: agg(list.filter((k) => k.category === 'RISK' && k.status === 'ENABLED')),
      active: list.filter((k) => k.status === 'ENABLED').length,
      cost: list.reduce((s, k) => s + k.cost, 0),
      impressions: list.reduce((s, k) => s + k.impressions, 0),
      clicks: list.reduce((s, k) => s + k.clicks, 0),
    };
  });

  protected readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    const cat = this.category();
    const st = this.status();
    return this.keywords()
      .filter(
        (k) =>
          (cat === 'ALL' || k.category === cat) &&
          (st === 'ALL' || k.status === st) &&
          (!q || k.text.toLowerCase().includes(q) || k.campaignName.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.cost - a.cost || a.text.localeCompare(b.text, 'pt-BR'));
  });

  protected readonly visible = computed(() => this.filtered().slice(0, this.shown()));

  constructor() {
    this.ws.keywordsBase.need();
    this.ws.keywordMetrics.need();
    this.ws.ads.need();
    this.ws.landingPages.need();
    this.ws.searchTermsRaw.need();
    this.ws.negatives.need();
    this.ws.gscQueries.need();
    this.ws.campaigns.need();
    this.ws.info.need();
  }

  protected val(event: Event): never {
    return (event.target as HTMLInputElement | HTMLSelectElement).value as never;
  }

  protected fmt = (k: KeywordRow): string => formatMatch(k.text, k.matchType);

  protected fmtText = (text: string, m: MatchType): string => formatMatch(text, m);

  protected sourceLabel(source: SuggestionSource): string {
    return source === 'SEARCH_CONSOLE' ? 'Search Console' : source === 'PLANNER' ? 'Planejador' : 'Termo de busca';
  }

  protected competitionLabel(c: string): string {
    return c === 'LOW' ? 'Baixa' : c === 'MEDIUM' ? 'Média' : c === 'HIGH' ? 'Alta' : '—';
  }

  protected pickCampaign(id: string): void {
    this.chosenCampaign.set(id);
    this.planner.result.set(null);
    this.planner.error.set(null);
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.info(`Copiado: ${text}`);
    } catch {
      this.toast.warning('Não foi possível copiar.');
    }
  }

  protected async copyAll(): Promise<void> {
    const list = this.campaignSuggestions().map((sg) => this.fmtText(sg.text, sg.matchType));
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      this.toast.info(`${list.length} sugestões copiadas, uma por linha.`);
    } catch {
      this.toast.warning('Não foi possível copiar.');
    }
  }

  /** Semente: palavras ativas da campanha com mais cliques e a página que ela usa. */
  protected async loadIdeas(): Promise<void> {
    const id = this.suggestCampaign();
    const seeds = this.keywords()
      .filter((k) => k.campaignId === id && k.status === 'ENABLED')
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10)
      .map((k) => k.text.replace(/[[\]"+]/g, '').trim());
    const url = this.fits().find((g) => g.campaignId === id && g.url)?.url ?? undefined;
    this.planner.loading.set(true);
    this.planner.error.set(null);
    try {
      this.planner.result.set(await firstValueFrom(this.api.keywordIdeas({ keywords: seeds, url }, this.account.selectedId() ?? undefined)));
    } catch {
      this.planner.error.set('Não foi possível consultar o Planejador agora. Tente de novo em instantes.');
    } finally {
      this.planner.loading.set(false);
    }
  }

  protected qsClass(score: number): string {
    const tone = score >= 7 ? 'badge-success' : score >= 5 ? 'badge-warning' : 'badge-error';
    return `badge badge-soft badge-sm tabular ${tone}`;
  }

  protected qsDetail(q: KeywordQuality): string {
    const r = (v: QualityRating | null): string =>
      v === 'ABOVE_AVERAGE' ? 'acima da média' : v === 'AVERAGE' ? 'na média' : v === 'BELOW_AVERAGE' ? 'abaixo da média' : 'sem nota';
    return `Relevância do anúncio: ${r(q.adRelevance)} · Página de destino: ${r(q.landingPage)} · CTR esperado: ${r(q.expectedCtr)}`;
  }

  protected path(url: string): string {
    try {
      const u = new URL(url);
      return u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
    } catch {
      return url;
    }
  }
  protected matchClass = (m: MatchType): string => `${MATCH_CLASS[m]} badge-xs`;
  protected matchLabel = (m: MatchType): string => MATCH_LABEL[m];
  protected catClass = (c: KeywordCategory): string => KEYWORD_CATEGORY_CLASS[c];
  protected catLabel = (c: KeywordCategory): string => KEYWORD_CATEGORY_LABEL[c];

  protected async toggle(kw: KeywordRow): Promise<void> {
    const next = kw.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    const r = await this.actions.setKeywordStatus(kw, next);
    if (r.ok) this.toast.success(r.message);
    else this.toast.error(r.message);
  }

  protected async capBrand(kw: KeywordRow): Promise<void> {
    const r = await this.actions.setKeywordBid(kw, BRAND_BID_CAP);
    if (r.ok) this.toast.success(r.message);
    else this.toast.error(r.message);
  }

  protected openBid(kw: KeywordRow): void {
    this.bidTarget.set(kw);
    this.bidValue.set({ amount: kw.bid ?? BRAND_BID_CAP });
    this.form_reset();
    this.bidOpen.set(true);
  }

  private form_reset(): void {
    this.bidForm().reset();
  }

  protected setBid(value: number): void {
    this.bidValue.set({ amount: value });
  }

  protected askDelete(kw: KeywordRow): void {
    this.deleteTarget.set(kw);
    this.deleteOpen.set(true);
  }

  protected async confirmDelete(kw: KeywordRow): Promise<void> {
    const r = await this.actions.removeKeyword(kw);
    if (r.ok) {
      this.toast.success(r.message);
      this.deleteOpen.set(false);
    } else {
      this.toast.error(r.message);
    }
  }
}
