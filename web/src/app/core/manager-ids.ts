import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

/**
 * Conta administradora (MCC) de cada conta de cliente. Fica separada do AccountStore
 * para o interceptor poder usá-la sem dependência circular (AccountStore → HttpClient).
 */
@Injectable({ providedIn: 'root' })
export class ManagerIds {
  private readonly byAccount = signal<ReadonlyMap<string, string>>(new Map());

  set(entries: Iterable<[accountId: string, managerId: string]>): void {
    this.byAccount.set(new Map(entries));
  }

  of(accountId: string): string | undefined {
    return this.byAccount().get(accountId.replace(/\D/g, ''));
  }
}

/**
 * Toda chamada a /api com x-customer-id leva também o MCC cadastrado para essa conta.
 * Sem MCC cadastrado, o servidor usa GOOGLE_ADS_LOGIN_CUSTOMER_ID (se houver).
 */
export const managerIdInterceptor: HttpInterceptorFn = (req, next) => {
  const customerId = req.headers.get('x-customer-id');
  if (!req.url.startsWith('/api/') || !customerId || req.headers.has('x-login-customer-id')) return next(req);
  const managerId = inject(ManagerIds).of(customerId);
  return next(managerId ? req.clone({ setHeaders: { 'x-login-customer-id': managerId } }) : req);
};
