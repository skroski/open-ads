// POST /api/keyword-status
// Pausa, ativa, remove ou ajusta o lance de uma palavra-chave no Google Ads.
import { endpoint } from './_lib/http.js';
import { mutateAds } from './_lib/google-ads.js';
import { buildKeywordOperation, onlyDigits } from './_lib/mutations.js';

export default endpoint(
  async ({ body, headers }) => {
    const customerId = onlyDigits(headers['x-customer-id'] || body?.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
    const loginCustomerId = headers['x-login-customer-id'] || body?.loginCustomerId;
    const operation = buildKeywordOperation({ ...body, customerId });
    const result = await mutateAds('adGroupCriteria', { operations: [operation] }, customerId, loginCustomerId);
    return { success: true, result };
  },
  { write: true },
);
