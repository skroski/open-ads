// Compatibilidade com as consultas GAQL existentes no painel.
import { endpoint } from './_lib/http.js';
import { customerId, runGaql } from './_lib/google-ads.js';

const DEFAULT_QUERY = `SELECT campaign.id, campaign.name, campaign.status,
  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
  FROM campaign WHERE segments.date DURING LAST_30_DAYS
  AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 50`;

export default endpoint(async ({ body, headers }) => {
  const id = customerId(headers['x-customer-id'] || body.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
  const results = await runGaql(body.query ?? DEFAULT_QUERY, id, headers['x-login-customer-id'] || body.loginCustomerId);
  return { results, currentCustomerId: id };
});
