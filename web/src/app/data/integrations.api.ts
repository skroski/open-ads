import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { DateWindow } from '../domain/dates';
import {
  Ga4ChannelRow,
  Ga4PageRow,
  PageAudit,
  SearchConsolePageRow,
  SearchConsoleQueryRow,
  SourceStatus,
} from '../domain/models';
import { normalizeUrl } from '../domain/text';

/** Resposta padrão das funções /api de integração: ou está configurada e traz dados, ou explica o porquê. */
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

export interface SearchConsoleDayRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface AuditResponse {
  configured: boolean;
  reason?: string;
  audit?: Omit<PageAudit, 'normalizedUrl'>;
}

@Injectable({ providedIn: 'root' })
export class IntegrationsApi {
  private readonly http = inject(HttpClient);

  private headers(customerId?: string): HttpHeaders {
    return customerId ? new HttpHeaders({ 'x-customer-id': customerId }) : new HttpHeaders();
  }

  ga4Pages(propertyId: string, w: DateWindow): Observable<SourceData<Ga4PageRow>> {
    return this.http
      .post<Envelope<Ga4PageRow>>('/api/analytics', { report: 'pages', propertyId, from: w.from, to: w.to })
      .pipe(map(unwrap));
  }

  ga4Channels(propertyId: string, w: DateWindow): Observable<SourceData<Ga4ChannelRow>> {
    return this.http
      .post<Envelope<Ga4ChannelRow>>('/api/analytics', { report: 'channels', propertyId, from: w.from, to: w.to })
      .pipe(map(unwrap));
  }

  searchConsolePages(site: string, w: DateWindow): Observable<SourceData<SearchConsolePageRow>> {
    return this.http
      .post<Envelope<SearchConsolePageRow>>('/api/search-console', {
        dimension: 'page',
        site,
        from: w.from,
        to: w.to,
      })
      .pipe(map(unwrap));
  }

  searchConsoleQueries(site: string, w: DateWindow): Observable<SourceData<SearchConsoleQueryRow>> {
    return this.http
      .post<Envelope<SearchConsoleQueryRow>>('/api/search-console', {
        dimension: 'query',
        site,
        from: w.from,
        to: w.to,
      })
      .pipe(map(unwrap));
  }

  /** Série diária do site inteiro, ou de uma página quando `page` é informado. */
  searchConsoleSeries(site: string, w: DateWindow, page?: string): Observable<SourceData<SearchConsoleDayRow>> {
    return this.http
      .post<Envelope<SearchConsoleDayRow>>('/api/search-console', {
        dimension: 'date',
        site,
        from: w.from,
        to: w.to,
        ...(page ? { page } : {}),
      })
      .pipe(map(unwrap));
  }

  auditPage(url: string, customerId: string): Observable<PageAudit> {
    return this.http
      .post<AuditResponse>('/api/page-audit', { url }, { headers: this.headers(customerId) })
      .pipe(
        map((res) => {
          if (!res.audit) {
            return {
              url,
              normalizedUrl: normalizeUrl(url),
              fetchedAt: new Date().toISOString(),
              status: null,
              ok: false,
              h1: [],
              h2: [],
              forms: 0,
              telLinks: 0,
              whatsappLinks: 0,
              hasViewport: false,
              hasCanonical: false,
              noindex: false,
              trackingTags: [],
              wordCount: 0,
              error: res.reason ?? 'A auditoria de páginas não está disponível.',
            } satisfies PageAudit;
          }
          return { ...res.audit, normalizedUrl: normalizeUrl(res.audit.finalUrl ?? url) } as PageAudit;
        }),
      );
  }

  explain(payload: unknown): Observable<{ configured: boolean; reason?: string; text?: string }> {
    return this.http.post<{ configured: boolean; reason?: string; text?: string }>('/api/explain', payload);
  }
}
