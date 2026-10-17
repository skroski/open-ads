// POST /api/tag-manager — leitura da configuração do Google Tag Manager API v2.
//
// Corpo:
//   { resource: 'accounts' }
//   { resource: 'containers', parent: 'accounts/123' }
//   { resource: 'workspaces', parent: 'accounts/123/containers/456' }
//   { resource: 'snapshot', parent: 'accounts/123/containers/456/workspaces/789' }
//
// O contrato trabalha apenas com os caminhos relativos oficiais do GTM, em vez de
// IDs ou nomes de uma conta específica. Assim, o front pode trocar de cliente,
// contêiner ou workspace sem mudar o servidor. Esta rota é deliberadamente
// somente leitura: não cria, publica ou altera tags.

import { HttpError, endpoint } from './_lib/http.js';
import { getAccessToken } from './_lib/google-auth.js';

const API = 'https://tagmanager.googleapis.com/tagmanager/v2';
const ACCOUNT = /^accounts\/\d+$/;
const CONTAINER = /^accounts\/\d+\/containers\/\d+$/;
const WORKSPACE = /^accounts\/\d+\/containers\/\d+\/workspaces\/\d+$/;

const NOT_AUTHORIZED =
  'O acesso ao Google Tag Manager não foi autorizado. Ative a "Google Tag Manager API" no Google Cloud e gere um novo refresh token com npm run token, autorizando o acesso de leitura ao Tag Manager.';

function assertParent(resource, parent) {
  const value = String(parent ?? '');
  const valid =
    (resource === 'containers' && ACCOUNT.test(value)) ||
    (resource === 'workspaces' && CONTAINER.test(value)) ||
    (resource === 'snapshot' && WORKSPACE.test(value));
  if (!valid) throw new HttpError(400, 'Caminho do recurso do Tag Manager inválido.');
  return value;
}

function tagSummary(tag) {
  const consent = String(tag.consentSettings?.consentStatus ?? 'notSet');
  return {
    id: String(tag.tagId ?? ''),
    name: String(tag.name ?? ''),
    type: String(tag.type ?? ''),
    paused: Boolean(tag.paused),
    firingTriggerIds: Array.isArray(tag.firingTriggerId) ? tag.firingTriggerId.map(String) : [],
    // Expõe só o estado, nunca os tipos ou valores de consentimento configurados.
    consentStatus: consent === 'needed' ? 'NEEDED' : consent === 'notNeeded' ? 'NOT_NEEDED' : consent === 'notSet' ? 'NOT_SET' : 'UNKNOWN',
  };
}

function triggerSummary(trigger) {
  return {
    id: String(trigger.triggerId ?? ''),
    name: String(trigger.name ?? ''),
    type: String(trigger.type ?? ''),
  };
}

function variableSummary(variable) {
  return {
    id: String(variable.variableId ?? ''),
    name: String(variable.name ?? ''),
    type: String(variable.type ?? ''),
  };
}

export function mapAccounts(data) {
  return (data.account ?? []).map((account) => ({
    path: String(account.path ?? ''),
    id: String(account.accountId ?? ''),
    name: String(account.name ?? ''),
  }));
}

export function mapContainers(data) {
  return (data.container ?? []).map((container) => ({
    path: String(container.path ?? ''),
    id: String(container.containerId ?? ''),
    publicId: String(container.publicId ?? ''),
    name: String(container.name ?? ''),
    usageContext: Array.isArray(container.usageContext) ? container.usageContext.map(String) : [],
  }));
}

export function mapWorkspaces(data) {
  return (data.workspace ?? []).map((workspace) => ({
    path: String(workspace.path ?? ''),
    id: String(workspace.workspaceId ?? ''),
    name: String(workspace.name ?? ''),
    description: String(workspace.description ?? ''),
  }));
}

async function gtmGet(token, path) {
  const res = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) return { denied: true, message: data?.error?.message };
  if (!res.ok) throw new HttpError(502, `Google Tag Manager respondeu ${res.status}: ${data?.error?.message ?? 'erro'}`);
  return { data };
}

async function list(token, path, key) {
  const items = [];
  let pageToken = '';
  // Evita que uma conta com dados inesperados prenda a função numa paginação infinita.
  for (let page = 0; page < 100; page += 1) {
    const suffix = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
    const response = await gtmGet(token, `${path}${suffix}`);
    if (response.denied) return response;
    items.push(...(response.data[key] ?? []));
    pageToken = response.data.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return { data: items };
}

export default endpoint(async ({ body }) => {
  const resource = body?.resource;
  if (!['accounts', 'containers', 'workspaces', 'snapshot'].includes(resource)) {
    throw new HttpError(400, 'Recurso do Tag Manager inválido.');
  }
  const parent = resource === 'accounts' ? '' : assertParent(resource, body?.parent);

  let token;
  try {
    token = await getAccessToken('tagmanager');
  } catch (err) {
    return { configured: false, reason: err.message };
  }
  if (!token) {
    return {
      configured: false,
      reason: 'Credenciais OAuth ausentes no servidor (GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET e um refresh token).',
    };
  }

  if (resource === 'accounts') {
    const response = await list(token, 'accounts', 'account');
    if (response.denied) return { configured: false, reason: `${NOT_AUTHORIZED}${response.message ? ` (${response.message})` : ''}` };
    return { configured: true, accounts: mapAccounts({ account: response.data }) };
  }
  if (resource === 'containers') {
    const response = await list(token, `${parent}/containers`, 'container');
    if (response.denied) return { configured: false, reason: `${NOT_AUTHORIZED}${response.message ? ` (${response.message})` : ''}` };
    return { configured: true, containers: mapContainers({ container: response.data }) };
  }
  if (resource === 'workspaces') {
    const response = await list(token, `${parent}/workspaces`, 'workspace');
    if (response.denied) return { configured: false, reason: `${NOT_AUTHORIZED}${response.message ? ` (${response.message})` : ''}` };
    return { configured: true, workspaces: mapWorkspaces({ workspace: response.data }) };
  }

  const [tags, triggers, variables] = await Promise.all([
    list(token, `${parent}/tags`, 'tag'),
    list(token, `${parent}/triggers`, 'trigger'),
    list(token, `${parent}/variables`, 'variable'),
  ]);
  const denied = [tags, triggers, variables].find((response) => response.denied);
  if (denied) return { configured: false, reason: `${NOT_AUTHORIZED}${denied.message ? ` (${denied.message})` : ''}` };
  return {
    configured: true,
    snapshot: {
      workspacePath: parent,
      tags: tags.data.map(tagSummary),
      triggers: triggers.data.map(triggerSummary),
      variables: variables.data.map(variableSummary),
    },
  };
});
