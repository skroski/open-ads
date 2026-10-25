// POST /api/display-demographics — exclui ou reinclui um perfil demográfico (idade, gênero, renda, situação
// parental) nos grupos de anúncios de uma campanha de Display. A leitura dos números é feita pelo painel.
//
// Corpo: { campaignId, dimension: 'AGE'|'GENDER'|'INCOME'|'PARENTAL', segment, change: 'exclude'|'include',
//          step: 'preview'|'apply' }
//  - preview: valida a operação no Google Ads com validateOnly, sem gravar nada.
//  - apply:   grava. O painel só envia depois de o usuário confirmar.
import { HttpError, endpoint } from './_lib/http.js';
import { mutateAds, runGaql } from './_lib/google-ads.js';
import { buildOperations, criteriaQuery, readCriteria, validateRequest } from './_lib/display-demographics.js';
import { onlyDigits } from './_lib/mutations.js';

export default endpoint(
  async ({ body, headers }) => {
    const customerId = onlyDigits(headers['x-customer-id'] || body?.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
    const loginCustomerId = headers['x-login-customer-id'] || body?.loginCustomerId;
    const request = validateRequest(body);

    const rows = await runGaql(criteriaQuery(request.dimension, request.campaignId), customerId, loginCustomerId);
    const criteria = readCriteria(rows, request.dimension);
    if (!criteria.length) {
      throw new HttpError(404, 'Nenhum grupo de anúncios ativo de Display com esta segmentação foi encontrado nessa campanha.');
    }
    const { operations, adGroups, unchanged } = buildOperations(request, criteria);
    if (!operations.length) {
      return { success: true, applied: false, unchanged: true, adGroups: 0, totalOperations: 0 };
    }

    const validateOnly = request.step !== 'apply';
    const result = await mutateAds('googleAds', { mutateOperations: operations, validateOnly }, customerId, loginCustomerId);
    return { success: true, applied: !validateOnly, adGroups, unchanged, totalOperations: operations.length, result };
  },
  { write: true },
);
