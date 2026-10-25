import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { MatchType } from '../domain/models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

interface SearchResponse {
  results: Raw[];
  currentCustomerId?: string;
}

export interface KeywordIdea {
  text: string;
  avgMonthlySearches: number;
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNSPECIFIED' | 'UNKNOWN';
  lowBid: number | null;
  highBid: number | null;
}

export interface KeywordIdeasResult {
  ideas: KeywordIdea[];
  /** DEVELOPER_TOKEN_NOT_APPROVED quando o token não tem acesso ao Planejador. */
  code?: string;
  error?: string;
}

export interface MutationResult {
  success: boolean;
  result?: unknown;
  totalOperations?: number;
}

/** Camada HTTP fina sobre as funções /api. Não interpreta dados. */
@Injectable({ providedIn: 'root' })
export class GoogleAdsApi {
  private readonly http = inject(HttpClient);

  private headers(customerId?: string, loginCustomerId?: string): HttpHeaders {
    const config: Record<string, string> = {};
    if (customerId) config['x-customer-id'] = customerId;
    if (loginCustomerId) config['x-login-customer-id'] = loginCustomerId;
    return new HttpHeaders(config);
  }

  search(query: string, customerId?: string, loginCustomerId?: string): Observable<Raw[]> {
    return this.http
      .post<SearchResponse>('/api/search', { query }, { headers: this.headers(customerId, loginCustomerId) })
      .pipe(map((res) => res.results ?? []));
  }

  accounts(
    customerId?: string,
    loginCustomerId?: string,
  ): Observable<{ results: Raw[]; currentCustomerId: string }> {
    return this.http
      .post<SearchResponse>('/api/accounts', {}, { headers: this.headers(customerId, loginCustomerId) })
      .pipe(
        map((res) => ({
          results: res.results ?? [],
          currentCustomerId: String(res.currentCustomerId ?? customerId ?? ''),
        })),
      );
  }

  addNegatives(
    keywords: ReadonlyArray<string | { text: string; matchType?: MatchType }>,
    options: { campaignId?: string; campaignIds?: string[]; matchType: MatchType },
    customerId?: string,
  ): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/negative-keyword',
      {
        campaignId: options.campaignId,
        campaignIds: options.campaignIds,
        keywords,
        matchType: options.matchType,
      },
      { headers: this.headers(customerId) },
    );
  }

  /** Exclui ou reinclui um perfil demográfico nos grupos de uma campanha de Display. `preview` só valida. */
  displayDemographics(
    payload: { campaignId: string; dimension: string; segment: string; change: 'exclude' | 'include'; step: 'preview' | 'apply' },
    customerId?: string,
  ): Observable<{ success: boolean; applied: boolean; unchanged?: boolean; adGroups: number; totalOperations: number }> {
    return this.http.post<{ success: boolean; applied: boolean; unchanged?: boolean; adGroups: number; totalOperations: number }>(
      '/api/display-demographics',
      payload,
      { headers: this.headers(customerId) },
    );
  }

  addNegative(
    campaignId: string,
    text: string,
    matchType: MatchType,
    customerId?: string,
  ): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/negative-keyword',
      { campaignId, text, matchType },
      { headers: this.headers(customerId) },
    );
  }

  setKeywordStatus(
    resourceName: string,
    status: 'ENABLED' | 'PAUSED',
    customerId?: string,
  ): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/keyword-status',
      { resourceName, status },
      { headers: this.headers(customerId) },
    );
  }

  removeKeyword(resourceName: string, customerId?: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/keyword-status',
      { resourceName, action: 'REMOVE' },
      { headers: this.headers(customerId) },
    );
  }

  setKeywordBid(resourceName: string, cpcBidBrl: number, customerId?: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/keyword-status',
      { resourceName, cpcBidBrl, action: 'BID' },
      { headers: this.headers(customerId) },
    );
  }

  /** Ideias do Planejador de Palavras-chave (somente leitura). */
  keywordIdeas(seed: { keywords: string[]; url?: string }, customerId?: string): Observable<KeywordIdeasResult> {
    return this.http.post<KeywordIdeasResult>('/api/keyword-ideas', seed, { headers: this.headers(customerId) });
  }
}
