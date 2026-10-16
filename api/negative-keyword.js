// POST /api/negative-keyword
// Adiciona palavras-chave negativas diretamente na campanha do Google Ads.
import { endpoint } from './_lib/http.js';
import { mutateAds } from './_lib/google-ads.js';
import { buildNegativeOperations, onlyDigits } from './_lib/mutations.js';

export default endpoint(
  async ({ body, headers }) => {
    const customerId = onlyDigits(headers['x-customer-id'] || body?.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
    const loginCustomerId = headers['x-login-customer-id'] || body?.loginCustomerId;
    const operations = buildNegativeOperations({ ...body, customerId });
    const result = await mutateAds('campaignCriteria', { operations, partialFailure: true }, customerId, loginCustomerId);
    return { success: true, result, totalOperations: operations.length };
  },
  { write: true },
);
