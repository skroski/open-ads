// Interface de relatórios prontos, usada tanto por assistentes quanto pelo painel.
import { endpoint, HttpError } from './_lib/http.js';
import { customerId, runGaql } from './_lib/google-ads.js';

const METRICS = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions';
const REPORTS = {
  conta: { resource: 'customer', fields: 'customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone', dated: false },
  contas: { resource: 'customer_client', fields: 'customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status', dated: false },
  campanhas: { resource: 'campaign', fields: `campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ${METRICS}` },
  'palavras-chave': { resource: 'keyword_view', fields: `campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, ${METRICS}` },
  termos: { resource: 'search_term_view', fields: `campaign.id, campaign.name, ad_group.id, ad_group.name, search_term_view.search_term, ${METRICS}` },
  dispositivos: { resource: 'campaign', fields: `segments.device, ${METRICS}` },
};

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Informe datas no formato AAAA-MM-DD.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Data inválida.');
  return value;
}

export function buildReport(body) {
  const definition = Object.hasOwn(REPORTS, body.report) ? REPORTS[body.report] : null;
  if (!definition) throw new HttpError(400, `Relatório inválido. Opções: ${Object.keys(REPORTS).join(', ')}.`);
  const limit = body.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new HttpError(400, 'O limite deve ser um inteiro de 1 a 5000.');
  const dated = definition.dated !== false;
  const from = dated ? date(body.from) : null;
  const to = dated ? date(body.to) : null;
  if (dated && from > to) throw new HttpError(400, 'A data inicial deve ser anterior ou igual à final.');
  const where = dated ? ` WHERE segments.date BETWEEN '${from}' AND '${to}'` : '';
  return {
    query: `SELECT ${definition.fields} FROM ${definition.resource}${where}${dated ? ' ORDER BY metrics.cost_micros DESC' : ''} LIMIT ${limit}`,
    period: dated ? { from, to } : null,
    limit,
  };
}

export default endpoint(async ({ body, headers }) => {
  const report = buildReport(body);
  const id = customerId(headers['x-customer-id'] || body.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
  const results = await runGaql(report.query, id, headers['x-login-customer-id'] || body.loginCustomerId);
  return {
    source: 'Google Ads API', report: body.report, currentCustomerId: id,
    period: report.period, costUnit: 'micros da moeda da conta',
    limit: report.limit, possiblyTruncated: results.length >= report.limit, results,
  };
});
