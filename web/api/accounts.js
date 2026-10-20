// Lista as contas acessíveis pela conta atual ou MCC.
import { endpoint } from './_lib/http.js';
import { customerId, runGaql } from './_lib/google-ads.js';

export default endpoint(async ({ body, headers }) => {
  const id = customerId(headers['x-customer-id'] || body.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
  const results = await runGaql(`SELECT customer_client.client_customer,
    customer_client.descriptive_name, customer_client.id, customer_client.manager, customer_client.status
    FROM customer_client WHERE customer_client.status = ENABLED`,
    id, headers['x-login-customer-id'] || body.loginCustomerId);
  return { results, currentCustomerId: id };
});
