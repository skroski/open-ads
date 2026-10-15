import { Injectable, computed, inject, signal } from '@angular/core';
import { MatchType } from '../domain/models';
import { AdsActions } from './ads-actions';
import { ToastService } from './toast.service';
import { Workspace } from './workspace';

/**
 * Estado do modal de "negativar em lote", compartilhado por várias telas
 * (termos de pesquisa, desperdícios, plano de ação).
 */
@Injectable({ providedIn: 'root' })
export class BatchNegatives {
  private readonly actions = inject(AdsActions);
  private readonly ws = inject(Workspace);
  private readonly toast = inject(ToastService);

  readonly open = signal(false);
  readonly terms = signal<string[]>([]);
  readonly matchType = signal<MatchType>('EXACT');
  /** "ALL" ou o id de uma campanha. */
  readonly target = signal('ALL');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly campaigns = computed(() => this.ws.campaigns.value() ?? []);

  show(terms: readonly string[]): void {
    this.ws.campaigns.need();
    this.terms.set(Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean))));
    this.error.set(null);
    this.open.set(true);
  }

  remove(term: string): void {
    this.terms.update((list) => list.filter((t) => t !== term));
  }

  clear(): void {
    this.terms.set([]);
  }

  async submit(): Promise<void> {
    const terms = this.terms();
    if (!terms.length || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);

    const target = this.target();
    const options =
      target === 'ALL'
        ? { matchType: this.matchType(), campaignIds: this.campaigns().map((c) => c.id) }
        : { matchType: this.matchType(), campaignId: target };

    const result = await this.actions.negateTerms(terms, options);
    this.submitting.set(false);
    if (result.ok) {
      this.toast.success(result.message);
      this.terms.set([]);
      this.open.set(false);
    } else {
      this.error.set(result.message);
    }
  }
}
