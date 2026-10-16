import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';

const STORAGE_KEY = 'openads.accessToken';

/**
 * Código de acesso do painel (PANEL_ACCESS_TOKEN no servidor). Só é pedido quando a API
 * responde 401, ou seja, em instalações online protegidas. No uso local nunca aparece.
 */
@Injectable({ providedIn: 'root' })
export class AccessToken {
  private pending: Promise<string | null> | null = null;

  get(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* sem armazenamento: o código será pedido de novo */
    }
  }

  /** Pergunta o código uma única vez, mesmo com várias chamadas falhando juntas. */
  ask(): Promise<string | null> {
    this.pending ??= Promise.resolve().then(() => {
      const value = (globalThis.prompt?.('Este painel é protegido. Informe o código de acesso:') ?? '').trim();
      this.pending = null;
      if (!value) return null;
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        /* vale só para esta sessão de página */
      }
      return value;
    });
    return this.pending;
  }
}

const withToken = <T>(req: T & { clone: (u: { setHeaders: Record<string, string> }) => T }, token: string | null): T =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/** Anexa o código de acesso às chamadas a /api e o pede de novo quando a API recusa (401). */
export const accessTokenInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  const access = inject(AccessToken);
  return next(withToken(req, access.get())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      access.clear();
      return from(access.ask()).pipe(
        switchMap((token) => (token ? next(withToken(req, token)) : throwError(() => err))),
      );
    }),
  );
};
