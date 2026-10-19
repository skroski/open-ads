import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AccountProvider } from './state/account';
import { WorkspaceProvider } from './state/workspace';

export const ACCOUNT_ID = '1234567890';

type Handler = (url: string, body: { query?: string }) => unknown;

/**
 * Troca o `fetch` por respostas de teste da API local. `search` recebe o corpo da consulta
 * GAQL e devolve as linhas brutas do Google Ads (sem inventar nada além do que o teste pede).
 */
export function mockApi(search: (query: string) => unknown[] = () => [], extra: Handler = () => undefined) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as { query?: string }) : {};
    calls.push(url);
    let payload: unknown = extra(url, body);
    if (payload === undefined) {
      if (url === '/api/accounts') {
        payload = { results: [{ customerClient: { id: ACCOUNT_ID, descriptiveName: 'Conta Teste' } }], currentCustomerId: ACCOUNT_ID };
      } else if (url === '/api/search') {
        payload = { results: search(body.query ?? '') };
      } else {
        payload = { configured: false, reason: 'não configurado no teste' };
      }
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export function renderWithProviders(ui: ReactElement, route = '/visao-geral') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AccountProvider>
        <WorkspaceProvider>{ui}</WorkspaceProvider>
      </AccountProvider>
    </MemoryRouter>,
  );
}
