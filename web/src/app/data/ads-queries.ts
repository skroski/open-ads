import { DateWindow } from '../domain/dates';

/**
 * Consultas GAQL. Cada uma foi validada contra uma conta real; os comentários
 * dizem por que o recorte existe, porque o Google Ads proíbe misturar alguns
 * segmentos com métricas e isso já custou caro em outras ferramentas.
 */

const between = (w: DateWindow): string => `segments.date BETWEEN '${w.from}' AND '${w.to}'`;

const METRICS = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions';

/** Aceita só dígitos: IDs vão para dentro de um IN (...) da consulta. */
const digitsOnly = (ids: readonly string[]): string[] => ids.filter((id) => /^\d+$/.test(id));

export const AdsQueries = {
  account: (): string =>
    `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1`,

  campaigns: (w: DateWindow): string => `
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ${METRICS}
    FROM campaign
    WHERE ${between(w)} AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200`,

  /** Série diária por campanha: base para rastreamento, maturação e efeito de mudanças. */
  daily: (w: DateWindow): string => `
    SELECT campaign.id, campaign.name, segments.date, ${METRICS}
    FROM campaign
    WHERE ${between(w)} AND campaign.status != 'REMOVED'`,

  searchTerms: (w: DateWindow, limit = 1000): string => `
    SELECT search_term_view.search_term, search_term_view.status,
           campaign.id, campaign.name, ad_group.id, ad_group.name, ${METRICS}
    FROM search_term_view
    WHERE ${between(w)}
    ORDER BY metrics.cost_micros DESC
    LIMIT ${Math.max(1, Math.floor(limit))}`,

  devices: (w: DateWindow): string => `
    SELECT segments.device, ${METRICS}
    FROM campaign
    WHERE ${between(w)} AND campaign.status != 'REMOVED'`,

  networks: (w: DateWindow): string => `
    SELECT segments.ad_network_type, ${METRICS}
    FROM campaign
    WHERE ${between(w)} AND campaign.status != 'REMOVED'`,

  /** Dia da semana × hora. Vem uma linha por campanha: agregue no cliente. */
  hours: (w: DateWindow): string => `
    SELECT segments.day_of_week, segments.hour, campaign.id, ${METRICS}
    FROM campaign
    WHERE ${between(w)} AND campaign.status != 'REMOVED'`,

  /**
   * Região por tipo de localização. Presença e interesse são partições do mesmo
   * total (cada clique entra em um só): verificado somando contra as campanhas.
   */
  regions: (w: DateWindow): string => `
    SELECT geographic_view.location_type, segments.geo_target_region, ${METRICS}
    FROM geographic_view
    WHERE ${between(w)}`,

  /** Resolve IDs de região para nomes legíveis. */
  geoConstants: (ids: readonly string[]): string => `
    SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name,
           geo_target_constant.target_type
    FROM geo_target_constant
    WHERE geo_target_constant.id IN (${digitsOnly(ids).join(', ') || '0'})`,

  landingPages: (w: DateWindow): string => `
    SELECT landing_page_view.unexpanded_final_url, campaign.id, campaign.name, ${METRICS}
    FROM landing_page_view
    WHERE ${between(w)}
    ORDER BY metrics.cost_micros DESC
    LIMIT 500`,

  ads: (w: DateWindow): string => `
    SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.status,
           ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
           campaign.id, campaign.name, ad_group.id, ad_group.name, ${METRICS}
    FROM ad_group_ad
    WHERE ${between(w)} AND ad_group_ad.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 300`,

  /** Onde os anúncios de Display realmente apareceram (apps, sites, YouTube). */
  placements: (w: DateWindow): string => `
    SELECT detail_placement_view.display_name, detail_placement_view.placement_type,
           detail_placement_view.target_url, campaign.id, ${METRICS}
    FROM detail_placement_view
    WHERE ${between(w)}
    ORDER BY metrics.cost_micros DESC
    LIMIT 500`,

  /**
   * Performance Max é estruturada por grupos de recursos, não por grupos de
   * anúncios. Métricas são do período e servem para investigação, não para
   * atribuir causalidade a um recurso isolado.
   */
  pmaxAssetGroups: (w: DateWindow): string => `
    SELECT asset_group.id, asset_group.name, asset_group.ad_strength,
           asset_group.asset_coverage, asset_group.primary_status,
           campaign.id, campaign.name, ${METRICS}
    FROM asset_group
    WHERE ${between(w)} AND asset_group.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 500`,

  /** Inventário e desempenho observado dos recursos usados por grupos PMax. */
  pmaxAssets: (w: DateWindow): string => `
    SELECT campaign.id, asset_group.id, asset_group_asset.asset,
           asset_group_asset.field_type, asset_group_asset.primary_status,
           asset_group_asset.status, ${METRICS}
    FROM asset_group_asset
    WHERE ${between(w)} AND asset_group_asset.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 2000`,

  conversionActions: (): string => `
    SELECT conversion_action.id, conversion_action.name, conversion_action.category,
           conversion_action.type, conversion_action.status, conversion_action.primary_for_goal,
           conversion_action.include_in_conversions_metric, conversion_action.counting_type,
           conversion_action.value_settings.default_value,
           conversion_action.value_settings.always_use_default_value
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'`,

  /**
   * Conversões por ação. Segmentar por ação de conversão impede selecionar cliques
   * e custo na mesma consulta; por isso esta consulta só traz métricas de conversão.
   */
  conversionBreakdown: (w: DateWindow): string => `
    SELECT campaign.id, segments.conversion_action_name, segments.conversion_action_category,
           metrics.conversions, metrics.all_conversions, metrics.conversions_value
    FROM campaign
    WHERE ${between(w)} AND campaign.status != 'REMOVED'`,

  negatives: (): string => `
    SELECT campaign.id, campaign.name, campaign_criterion.criterion_id,
           campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE
      AND campaign.status != 'REMOVED'
    LIMIT 10000`,

  /** Negativas de grupo de anúncios: valem só dentro do grupo (comum para separar tráfego). */
  adGroupNegatives: (): string => `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = TRUE
      AND ad_group_criterion.status != 'REMOVED' AND campaign.status != 'REMOVED'
    LIMIT 10000`,

  /** Quais campanhas usam cada lista compartilhada de palavras negativas. */
  sharedNegativeLinks: (): string => `
    SELECT campaign.id, campaign.name, shared_set.id, shared_set.name, campaign_shared_set.status
    FROM campaign_shared_set
    WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND campaign.status != 'REMOVED'
    LIMIT 10000`,

  /** Conteúdo das listas compartilhadas de palavras negativas. */
  sharedNegativeCriteria: (): string => `
    SELECT shared_set.id, shared_set.name, shared_criterion.criterion_id,
           shared_criterion.keyword.text, shared_criterion.keyword.match_type
    FROM shared_criterion
    WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'
    LIMIT 10000`,

  /** Cadastro de palavras (inclui as sem tráfego, que não aparecem em keyword_view). */
  keywords: (): string => `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           ad_group_criterion.resource_name, ad_group_criterion.criterion_id,
           ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           ad_group_criterion.status, ad_group_criterion.cpc_bid_micros,
           ad_group_criterion.final_urls,
           ad_group_criterion.quality_info.quality_score,
           ad_group_criterion.quality_info.creative_quality_score,
           ad_group_criterion.quality_info.post_click_quality_score,
           ad_group_criterion.quality_info.search_predicted_ctr
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.negative = FALSE
      AND ad_group_criterion.status != 'REMOVED'
    LIMIT 10000`,

  keywordMetrics: (w: DateWindow): string => `
    SELECT ad_group_criterion.resource_name, ${METRICS}
    FROM keyword_view
    WHERE ${between(w)} AND ad_group_criterion.status != 'REMOVED'
    LIMIT 1000`,

  /** Regiões segmentadas por campanha (pode divergir da área realmente atendida). */
  campaignLocations: (): string => `
    SELECT campaign.id, campaign_criterion.negative, campaign_criterion.location.geo_target_constant
    FROM campaign_criterion
    WHERE campaign_criterion.type = 'LOCATION' AND campaign.status != 'REMOVED'
    LIMIT 1000`,

  /**
   * O Google só guarda 30 dias de change_event e exige filtro de data e LIMIT.
   * `from` e `to` no formato "YYYY-MM-DD HH:mm:ss".
   */
  changeEvents: (from: string, to: string, limit = 500): string => `
    SELECT change_event.change_date_time, change_event.change_resource_type,
           change_event.resource_change_operation, change_event.changed_fields,
           change_event.user_email, change_event.client_type,
           change_event.campaign, change_event.ad_group
    FROM change_event
    WHERE change_event.change_date_time >= '${from}' AND change_event.change_date_time <= '${to}'
    ORDER BY change_event.change_date_time DESC
    LIMIT ${Math.min(Math.max(1, Math.floor(limit)), 10000)}`,
} as const;
