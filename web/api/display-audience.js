// POST /api/display-audience — público personalizado em campanha de Display.
//
// Corpo: { action: 'inspect' | 'preview' | 'apply', campaignId, name, keywords[], urls[], mode }
//  - inspect: só lê os grupos de anúncios (modo atual, segmentação otimizada, públicos existentes).
//  - preview: valida a operação no Google Ads com validateOnly, sem gravar nada.
//  - apply:   cria o público e o aplica. O painel só envia depois de o usuário confirmar.
import { HttpError, endpoint } from './_lib/http.js';
import { mutateAds, runGaql } from './_lib/google-ads.js';
import { buildAudienceMutateOperations, buildCustomAudienceOperation, restrictionsOf, validateAudienceRequest } from './_lib/display-audience.js';
import { onlyDigits } from './_lib/mutations.js';

async function readAdGroups(customerId, campaignId, loginCustomerId) {
  const rows = await runGaql(
    `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ad_group.id, ad_group.name, ad_group.resource_name, ad_group.status,
            ad_group.optimized_targeting_enabled, ad_group.targeting_setting.target_restrictions
     FROM ad_group WHERE campaign.id = ${campaignId} AND ad_group.status = 'ENABLED'`,
    customerId,
    loginCustomerId,
  );
  if (!rows.length) throw new HttpError(404, 'Nenhum grupo de anúncios ativo nessa campanha.');
  if (rows.some((r) => r.campaign?.advertisingChannelType !== 'DISPLAY')) {
    throw new HttpError(400, 'Esta ferramenta funciona só com campanhas de Display.');
  }
  const audiences = await runGaql(
    `SELECT ad_group.id, ad_group_criterion.display_name FROM ad_group_audience_view WHERE campaign.id = ${campaignId}`,
    customerId,
    loginCustomerId,
  ).catch(() => []);
  return {
    campaignName: rows[0].campaign?.name ?? '',
    adGroups: rows.map((r) => ({
      id: String(r.adGroup.id),
      name: r.adGroup.name,
      resourceName: r.adGroup.resourceName,
      optimizedTargeting: r.adGroup.optimizedTargetingEnabled !== false,
      restrictions: restrictionsOf(r.adGroup),
      audiences: audiences.filter((a) => String(a.adGroup?.id) === String(r.adGroup.id)).map((a) => a.adGroupCriterion?.displayName).filter(Boolean),
    })),
  };
}

export default endpoint(
  async ({ body, headers }) => {
    const customerId = onlyDigits(headers['x-customer-id'] || body?.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
    const loginCustomerId = headers['x-login-customer-id'] || body?.loginCustomerId;
    const action = String(body?.action ?? 'inspect');
    const campaignId = onlyDigits(body?.campaignId);
    if (!['inspect', 'preview', 'apply'].includes(action)) throw new HttpError(400, 'Ação inválida.');
    if (!campaignId) throw new HttpError(400, 'Escolha a campanha de Display.');

    const state = await readAdGroups(customerId, campaignId, loginCustomerId);
    if (action === 'inspect') return state;

    const request = { ...body, customerId, campaignId };
    const { mode } = validateAudienceRequest(request);
    const audience = mode === 'EXISTING' ? null : buildCustomAudienceOperation(request);

    if (action === 'preview') {
      // Valida o público e os ajustes dos grupos. Os critérios que ligam o público ao grupo só existem depois
      // de criado, então não são validados aqui.
      if (audience) await mutateAds('customAudiences', { operations: [audience], validateOnly: true }, customerId, loginCustomerId);
      const operations = buildAudienceMutateOperations(request, state.adGroups);
      const result = await mutateAds('googleAds', { mutateOperations: operations, validateOnly: true }, customerId, loginCustomerId);
      return { success: true, applied: false, adGroups: state.adGroups.length, totalOperations: operations.length, result };
    }

    let audienceName = null;
    if (audience) {
      const created = await mutateAds('customAudiences', { operations: [audience] }, customerId, loginCustomerId);
      audienceName = created?.results?.[0]?.resourceName ?? null;
      if (!audienceName) throw new HttpError(502, 'O Google Ads não devolveu o público criado.');
    }
    const operations = buildAudienceMutateOperations(request, state.adGroups, audienceName);
    let result;
    try {
      result = await mutateAds('googleAds', { mutateOperations: operations }, customerId, loginCustomerId);
    } catch (err) {
      // Sem os critérios, o público criado não serve para nada: tenta removê-lo para não deixar resto na conta.
      if (audienceName) {
        const removed = await mutateAds('customAudiences', { operations: [{ remove: audienceName }] }, customerId, loginCustomerId).catch(() => null);
        if (!removed) throw new HttpError(err.status ?? 502, `${err.message} O público ${audienceName} ficou criado na conta; remova-o no Google Ads.`);
      }
      throw err;
    }
    return { success: true, applied: true, adGroups: state.adGroups.length, totalOperations: operations.length, result };
  },
  { write: true },
);
