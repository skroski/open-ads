// Perfil demográfico em campanhas de Display (idade, gênero, renda, situação parental). Funções puras:
// validam o que chega do navegador e montam as operações que ESCREVEM no Google Ads (nada aqui fala com a rede).
//
// O Google cria um critério para cada perfil do grupo de anúncios, positivo ou negativo (excluído). O campo
// "negative" não muda depois de criado: para excluir ou reincluir, a operação remove o critério existente e cria
// outro com o valor novo, na mesma chamada (tudo ou nada).

import { HttpError } from './http.js';
import { onlyDigits } from './mutations.js';

export const DIMENSIONS = {
  AGE: {
    view: 'age_range_view',
    gaql: 'age_range',
    field: 'ageRange',
    segments: ['AGE_RANGE_18_24', 'AGE_RANGE_25_34', 'AGE_RANGE_35_44', 'AGE_RANGE_45_54', 'AGE_RANGE_55_64', 'AGE_RANGE_65_UP', 'AGE_RANGE_UNDETERMINED'],
  },
  GENDER: { view: 'gender_view', gaql: 'gender', field: 'gender', segments: ['MALE', 'FEMALE', 'UNDETERMINED'] },
  INCOME: {
    view: 'income_range_view',
    gaql: 'income_range',
    field: 'incomeRange',
    segments: ['INCOME_RANGE_0_50', 'INCOME_RANGE_50_60', 'INCOME_RANGE_60_70', 'INCOME_RANGE_70_80', 'INCOME_RANGE_80_90', 'INCOME_RANGE_90_UP', 'INCOME_RANGE_UNDETERMINED'],
  },
  PARENTAL: { view: 'parental_status_view', gaql: 'parental_status', field: 'parentalStatus', segments: ['PARENT', 'NOT_A_PARENT', 'UNKNOWN'] },
};

export const CHANGES = ['exclude', 'include'];
export const STEPS = ['preview', 'apply'];

/** Valida o pedido: campanha, dimensão, perfil e o que fazer com ele. */
export function validateRequest(body) {
  const campaignId = onlyDigits(body?.campaignId);
  if (!campaignId) throw new HttpError(400, 'Escolha a campanha de Display.');
  const dimension = String(body?.dimension ?? '');
  const dim = DIMENSIONS[dimension];
  if (!dim) throw new HttpError(400, 'Dimensão inválida.');
  const segment = String(body?.segment ?? '');
  if (!dim.segments.includes(segment)) throw new HttpError(400, 'Perfil inválido para esta dimensão.');
  const change = String(body?.change ?? '');
  if (!CHANGES.includes(change)) throw new HttpError(400, 'Mudança inválida: use "exclude" ou "include".');
  const step = String(body?.step ?? 'preview');
  if (!STEPS.includes(step)) throw new HttpError(400, 'Etapa inválida: use "preview" ou "apply".');
  return { campaignId, dimension, segment, change, step };
}

/** Critérios atuais da dimensão nos grupos ativos da campanha. Sem métricas: só o estado da segmentação. */
export function criteriaQuery(dimension, campaignId) {
  const dim = DIMENSIONS[dimension];
  return `SELECT ad_group.id, ad_group.resource_name, ad_group_criterion.resource_name, ad_group_criterion.negative,
          ad_group_criterion.${dim.gaql}.type
          FROM ${dim.view}
          WHERE campaign.id = ${onlyDigits(campaignId)} AND campaign.advertising_channel_type = 'DISPLAY' AND ad_group.status = 'ENABLED'`;
}

export function readCriteria(rows, dimension) {
  const dim = DIMENSIONS[dimension];
  return (rows ?? [])
    .map((r) => ({
      adGroupId: String(r.adGroup?.id ?? ''),
      adGroup: r.adGroup?.resourceName ?? '',
      resourceName: r.adGroupCriterion?.resourceName ?? '',
      segment: r.adGroupCriterion?.[dim.field]?.type ?? '',
      negative: r.adGroupCriterion?.negative === true,
    }))
    .filter((c) => c.adGroup && c.resourceName && c.segment);
}

/**
 * Operações do `googleAds:mutate`. Em cada grupo: se o perfil já está como pedido, nada muda; se está no estado
 * oposto, remove e recria; se não existe critério, cria. Excluir nunca pode deixar a dimensão sem nenhum perfil
 * ativo, porque o grupo deixaria de entregar.
 */
export function buildOperations({ dimension, segment, change }, criteria) {
  const dim = DIMENSIONS[dimension];
  const wantNegative = change === 'exclude';
  const byGroup = new Map();
  for (const c of criteria) {
    const list = byGroup.get(c.adGroup) ?? [];
    list.push(c);
    byGroup.set(c.adGroup, list);
  }
  const operations = [];
  let adGroups = 0;
  let unchanged = 0;
  for (const [adGroup, list] of byGroup) {
    const current = list.find((c) => c.segment === segment);
    if (current && current.negative === wantNegative) {
      unchanged += 1;
      continue;
    }
    if (wantNegative) {
      const stillActive = list.filter((c) => c.segment !== segment && !c.negative).length;
      if (stillActive === 0) {
        throw new HttpError(400, 'Isso excluiria todos os perfis desta dimensão e o grupo de anúncios deixaria de entregar. Mantenha ao menos um ativo.');
      }
    }
    if (current) operations.push({ adGroupCriterionOperation: { remove: current.resourceName } });
    operations.push({
      adGroupCriterionOperation: {
        create: { adGroup, [dim.field]: { type: segment }, ...(wantNegative ? { negative: true } : {}) },
      },
    });
    adGroups += 1;
  }
  return { operations, adGroups, unchanged };
}
