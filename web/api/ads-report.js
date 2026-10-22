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
  'configuracao-conversoes': {
    resource: 'conversion_action',
    fields: 'conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.type, conversion_action.status, conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric, conversion_action.counting_type, conversion_action.value_settings.default_value, conversion_action.value_settings.always_use_default_value',
    dated: false,
  },
  mudancas: {
    resource: 'change_event',
    fields: 'change_event.change_date_time, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, change_event.user_email, change_event.client_type, change_event.campaign, change_event.ad_group',
    dateField: 'change_event.change_date_time',
    timestamp: true,
    maxRangeDays: 30,
    orderBy: 'change_event.change_date_time DESC',
  },
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
  const rangeDays = dated ? Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  if (definition.maxRangeDays && rangeDays > definition.maxRangeDays) {
    throw new HttpError(400, `Este relatório aceita no máximo ${definition.maxRangeDays} dias.`);
  }
  const dateField = definition.dateField ?? 'segments.date';
  const end = definition.timestamp ? `${to} 23:59:59` : to;
  const start = definition.timestamp ? `${from} 00:00:00` : from;
  const where = dated ? ` WHERE ${dateField} BETWEEN '${start}' AND '${end}'` : '';
  const orderBy = dated ? definition.orderBy ?? 'metrics.cost_micros DESC' : '';
  return {
    query: `SELECT ${definition.fields} FROM ${definition.resource}${where}${orderBy ? ` ORDER BY ${orderBy}` : ''} LIMIT ${limit}`,
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
