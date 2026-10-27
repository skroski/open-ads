// Público personalizado em campanhas de Display. Funções puras: validam o que chega do navegador e
// montam as operações que ESCREVEM no Google Ads (nada aqui fala com a rede).
//
// O que a ferramenta faz: cria um público personalizado (por palavras e/ou sites) e o aplica aos
// grupos de anúncios de uma campanha de Display. O Google não segmenta por profissão ou cargo:
// o público é uma aproximação por interesse e comportamento.

import { HttpError } from './http.js';
import { onlyDigits } from './mutations.js';

/** EXISTING: não cria público; só passa a respeitar os públicos que o grupo já tem (desliga a expansão). */
export const MODES = ['RESTRICT', 'OBSERVE', 'EXISTING'];
export const MAX_MEMBERS = 50;
export const MAX_TERM_LENGTH = 80;
export const MAX_NAME_LENGTH = 80;

const GOOGLE_ADS_DIMENSION = 'AUDIENCE';

function uniqueTrimmed(list, label, transform) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const value = transform(String(raw ?? '').trim());
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  if (out.length > MAX_MEMBERS) throw new HttpError(400, `Use no máximo ${MAX_MEMBERS} ${label}.`);
  return out;
}

function toKeyword(value) {
  const cleaned = value.replace(/[\[\]"]/g, '').replace(/\s+/g, ' ');
  if (cleaned.length > MAX_TERM_LENGTH) throw new HttpError(400, `A palavra "${cleaned.slice(0, 20)}…" passa de ${MAX_TERM_LENGTH} caracteres.`);
  return cleaned;
}

function toUrl(value) {
  if (!value) return '';
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new HttpError(400, `Endereço inválido: ${value.slice(0, 40)}.`);
  }
  if (!parsed.hostname.includes('.')) throw new HttpError(400, `Endereço inválido: ${value.slice(0, 40)}.`);
  return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
}

/** Confere o pedido do navegador e devolve valores normalizados. */
export function validateAudienceRequest({ customerId, campaignId, name, keywords, urls, mode }) {
  const customer = onlyDigits(customerId);
  if (customer.length !== 10) throw new HttpError(400, 'Conta (Customer ID) não informada ou inválida.');
  const campaign = onlyDigits(campaignId);
  if (!campaign) throw new HttpError(400, 'Escolha a campanha de Display.');
  const chosenMode = String(mode ?? 'RESTRICT').toUpperCase();
  if (!MODES.includes(chosenMode)) throw new HttpError(400, `Modo inválido: ${mode}.`);
  if (chosenMode === 'EXISTING') return { customerId: customer, campaignId: campaign, name: '', keywords: [], urls: [], mode: chosenMode };
  const audienceName = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!audienceName) throw new HttpError(400, 'Dê um nome ao público.');
  if (audienceName.length > MAX_NAME_LENGTH) throw new HttpError(400, `O nome do público passa de ${MAX_NAME_LENGTH} caracteres.`);
  const kw = uniqueTrimmed(keywords, 'palavras', toKeyword);
  const sites = uniqueTrimmed(urls, 'sites', toUrl);
  if (!kw.length && !sites.length) throw new HttpError(400, 'Informe ao menos uma palavra ou um site que descreva o público.');
  return { customerId: customer, campaignId: campaign, name: audienceName, keywords: kw, urls: sites, mode: chosenMode };
}

/** Lê as restrições de segmentação de um grupo de anúncios, no formato da API REST. */
export function restrictionsOf(adGroup) {
  const list = adGroup?.targetingSetting?.targetRestrictions;
  return Array.isArray(list) ? list.map((r) => ({ targetingDimension: r.targetingDimension, bidOnly: Boolean(r.bidOnly) })) : [];
}

/** Troca só a dimensão de público, preservando as demais restrições do grupo. */
export function mergeAudienceRestriction(restrictions, mode) {
  const others = restrictions.filter((r) => r.targetingDimension !== GOOGLE_ADS_DIMENSION);
  return [...others, { targetingDimension: GOOGLE_ADS_DIMENSION, bidOnly: mode === 'OBSERVE' }];
}

/** Operação do `customAudiences:mutate` (serviço próprio, separado do `googleAds:mutate`): cria o público. */
export function buildCustomAudienceOperation(request) {
  const req = validateAudienceRequest(request);
  const members = [
    ...req.keywords.map((keyword) => ({ memberType: 'KEYWORD', keyword })),
    ...req.urls.map((url) => ({ memberType: 'URL', url })),
  ];
  return { create: { name: req.name, type: 'AUTO', description: 'Criado pelo painel', members } };
}

/**
 * Operações do `googleAds:mutate` nos grupos de anúncios. Com `audienceResourceName` (público já criado),
 * vêm primeiro os critérios que apontam para ele; depois o ajuste de cada grupo. Sem o nome, só os ajustes:
 * é o caso da validação, em que o público ainda não existe.
 * `adGroups`: [{ resourceName, restrictions }] lidos da conta imediatamente antes.
 */
export function buildAudienceMutateOperations(request, adGroups, audienceResourceName = null) {
  const req = validateAudienceRequest(request);
  if (!Array.isArray(adGroups) || !adGroups.length) throw new HttpError(400, 'A campanha não tem grupos de anúncios ativos para receber o público.');
  const prefix = `customers/${req.customerId}/adGroups/`;
  if (adGroups.some((g) => typeof g.resourceName !== 'string' || !g.resourceName.startsWith(prefix))) {
    throw new HttpError(400, 'Um grupo de anúncios não pertence à conta informada.');
  }
  const operations = [];
  if (req.mode !== 'EXISTING' && audienceResourceName) {
    for (const g of adGroups) {
      operations.push({ adGroupCriterionOperation: { create: { adGroup: g.resourceName, customAudience: { customAudience: audienceResourceName } } } });
    }
  }
  for (const g of adGroups) {
    const update = { resourceName: g.resourceName, targetingSetting: { targetRestrictions: mergeAudienceRestriction(g.restrictions ?? [], req.mode === 'OBSERVE' ? 'OBSERVE' : 'RESTRICT') } };
    let updateMask = 'targeting_setting.target_restrictions';
    if (req.mode !== 'OBSERVE') {
      // Com a segmentação otimizada ligada, o Google mostra anúncios fora do público escolhido.
      update.optimizedTargetingEnabled = false;
      updateMask += ',optimized_targeting_enabled';
    }
    operations.push({ adGroupOperation: { updateMask, update } });
  }
  return operations;
}
