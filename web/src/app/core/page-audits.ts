import { Injectable, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IntegrationsApi } from '../data/integrations.api';
import { PageAudit } from '../domain/models';
import { normalizeUrl } from '../domain/text';
import { AccountStore } from './account.store';
import { describeError } from './dataset';

const TTL_MS = 24 * 60 * 60 * 1000;
const key = (accountId: string): string => `gads_page_audits_${accountId || 'default'}`;

function load(accountId: string): Record<string, PageAudit> {
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PageAudit>;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, a]) => now - new Date(a.fetchedAt).getTime() < TTL_MS),
    );
  } catch {
    return {};
  }
}

/**
 * Leituras de página do site (título, h1, formulário, botões de contato, etiquetas).
 * Ficam em cache por 24 horas para não pedir a mesma página várias vezes.
 */
@Injectable({ providedIn: 'root' })
export class PageAudits {
  private readonly api = inject(IntegrationsApi);
  private readonly account = inject(AccountStore);

  readonly audits = linkedSignal<string, Record<string, PageAudit>>({
    source: this.account.selectedId,
    computation: (id) => load(id),
  });
  readonly running = signal<ReadonlySet<string>>(new Set());
  readonly lastError = signal<string | null>(null);

  readonly byUrl = computed(() => new Map(Object.entries(this.audits())));

  constructor() {
    // Persiste o cache sempre que muda.
    effect(() => {
      const value = this.audits();
      const id = untracked(() => this.account.selectedId());
      try {
        localStorage.setItem(key(id), JSON.stringify(value));
      } catch {
        /* sem armazenamento: o cache vale só nesta sessão */
      }
    });
  }

  get(url: string): PageAudit | undefined {
    return this.audits()[normalizeUrl(url)];
  }

  isRunning(url: string): boolean {
    return this.running().has(normalizeUrl(url));
  }

  async audit(url: string, force = false): Promise<PageAudit | undefined> {
    const norm = normalizeUrl(url);
    if (!force && this.audits()[norm]) return this.audits()[norm];
    if (this.running().has(norm)) return undefined;

    this.running.update((s) => new Set(s).add(norm));
    this.lastError.set(null);
    try {
      const audit = await firstValueFrom(this.api.auditPage(url, this.account.selectedId()));
      this.audits.update((m) => ({ ...m, [norm]: audit }));
      return audit;
    } catch (e) {
      this.lastError.set(describeError(e));
      return undefined;
    } finally {
      this.running.update((s) => {
        const next = new Set(s);
        next.delete(norm);
        return next;
      });
    }
  }

  /** Audita várias páginas, no máximo 3 por vez. */
  async auditMany(urls: readonly string[]): Promise<void> {
    const queue = Array.from(new Set(urls.map((u) => u)));
    const worker = async (): Promise<void> => {
      for (let u = queue.shift(); u !== undefined; u = queue.shift()) await this.audit(u);
    };
    await Promise.all([worker(), worker(), worker()]);
  }
}
