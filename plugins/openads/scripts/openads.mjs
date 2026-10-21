#!/usr/bin/env node
// Cliente somente de leitura. Credenciais Google permanecem no servidor do painel.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    customer: { type: 'string' }, login: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
    limit: { type: 'string' }, keywords: { type: 'string' }, url: { type: 'string' },
    language: { type: 'string' }, geo: { type: 'string' }, 'target-cpa': { type: 'string' },
  } });
  const reports = ['conta', 'contas', 'campanhas', 'palavras-chave', 'termos', 'dispositivos', 'configuracao-conversoes', 'mudancas', 'ideias'];
  const composites = {
    'diagnostico-eficiencia': ['campanhas', 'termos', 'palavras-chave', 'dispositivos'],
    oportunidades: ['campanhas', 'termos', 'palavras-chave'],
    'auditoria-medicao': ['configuracao-conversoes', 'campanhas'],
    'auditoria-mudancas': ['mudancas'],
  };
  const command = positionals[0] ?? 'ajuda';
  const commands = [...reports, ...Object.keys(composites)];
  if (command === 'ajuda') return { reports, commands, example: 'diagnostico-eficiencia --customer 1234567890 --from 2026-09-01 --to 2026-09-30 --target-cpa 80', api: 'http://127.0.0.1:3000', authentication: 'PANEL_ACCESS_TOKEN no ambiente, quando configurado no painel. Não passe segredos como argumentos.' };
  if ((!reports.includes(command) && !Object.hasOwn(composites, command)) || positionals.length !== 1) throw new Error(`Escolha um comando: ${commands.join(', ')}.`);
  const base = new URL(process.env.OPENADS_API_URL || 'http://127.0.0.1:3000');
  if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) {
    throw new Error('Use uma origem HTTPS ou HTTP local sem credenciais na URL.');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.PANEL_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.PANEL_ACCESS_TOKEN}`;
  if (values.customer) headers['x-customer-id'] = values.customer;
  if (values.login) headers['x-login-customer-id'] = values.login;
  const request = async (report) => {
    const body = report === 'ideias' ? {
      keywords: values.keywords?.split(',').map((word) => word.trim()).filter(Boolean), url: values.url,
      language: values.language, geoTargets: values.geo?.split(','),
    } : { report, from: values.from, to: values.to, ...(values.limit ? { limit: Number(values.limit) } : {}) };
    let response;
    try {
      response = await fetch(new URL(report === 'ideias' ? '/api/keyword-ideas' : '/api/ads-report', base), {
        method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(80_000),
      });
    } catch {
      throw new Error('Não foi possível acessar a API do OpenAds. Confira se ela está rodando e se OPENADS_API_URL está correto.');
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('A API não retornou JSON. Confira a URL e a autenticação do painel.'); }
    if (!response.ok) throw new Error(data.error || `A consulta falhou (${report}, HTTP ${response.status}).`);
    return data;
  };
  if (!Object.hasOwn(composites, command)) return request(command);
  const requestedReports = composites[command];
  const results = await Promise.all(requestedReports.map(async (report) => [report, await request(report)]));
  return {
    command,
    source: 'Google Ads API',
    context: values['target-cpa'] ? { targetCpa: values['target-cpa'], targetCpaUnit: 'moeda da conta por conversão' } : {},
    reports: Object.fromEntries(results),
    note: 'Dados para análise. O cliente não infere causalidade nem executa alterações no Google Ads.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((data) => console.log(JSON.stringify(data, null, 2))).catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  });
}
