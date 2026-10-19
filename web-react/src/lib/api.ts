import type { DateWindow } from '@shared/domain/dates';
import type {
  Ga4PageRow,
  SearchConsolePageRow,
  SearchConsoleQueryRow,
  SourceStatus,
} from '@shared/domain/models';
import { post } from './http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

interface SearchResponse {
  results: Raw[];
  currentCustomerId?: string;
}

/** Consulta GAQL na conta (somente leitura). */
export async function search(query: string, customerId?: string, signal?: AbortSignal): Promise<Raw[]> {
  const res = await post<SearchResponse>('/api/search', { query }, { customerId, signal });
  return res.results ?? [];
}

export async function accounts(
  customerId?: string,
  loginCustomerId?: string,
  signal?: AbortSignal,
): Promise<{ results: Raw[]; currentCustomerId: string }> {
  const res = await post<SearchResponse>('/api/accounts', {}, { customerId, loginCustomerId, signal });
  return { results: res.results ?? [], currentCustomerId: String(res.currentCustomerId ?? customerId ?? '') };
}

/** Resposta padrão das funções de integração: ou está configurada e traz dados, ou explica o porquê. */
interface Envelope<T> {
  configured: boolean;
  reason?: string;
  rows?: T[];
}

export interface SourceData<T> {
  status: SourceStatus;
  rows: T[];
}

function unwrap<T>(env: Envelope<T>): SourceData<T> {
  return {
    status: { configured: env.configured, reason: env.reason },
    rows: env.configured ? (env.rows ?? []) : [],
  };
}

export async function ga4Pages(propertyId: string, w: DateWindow, signal?: AbortSignal): Promise<SourceData<Ga4PageRow>> {
  return unwrap(await post<Envelope<Ga4PageRow>>('/api/analytics', { report: 'pages', propertyId, from: w.from, to: w.to }, { signal }));
}

export async function searchConsolePages(
  site: string,
  w: DateWindow,
  signal?: AbortSignal,
): Promise<SourceData<SearchConsolePageRow>> {
  return unwrap(await post<Envelope<SearchConsolePageRow>>('/api/search-console', { dimension: 'page', site, from: w.from, to: w.to }, { signal }));
}

export async function searchConsoleQueries(
  site: string,
  w: DateWindow,
  signal?: AbortSignal,
): Promise<SourceData<SearchConsoleQueryRow>> {
  return unwrap(await post<Envelope<SearchConsoleQueryRow>>('/api/search-console', { dimension: 'query', site, from: w.from, to: w.to }, { signal }));
}
