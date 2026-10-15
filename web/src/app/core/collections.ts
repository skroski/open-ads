import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  ChangeEntry,
  ContentItem,
  GoogleAdsChange,
  Hypothesis,
  Lead,
  Learning,
  RecommendationState,
  RecommendationStatus,
  SupportQuestion,
} from '../domain/models';
import { AccountStore } from './account.store';
import { DbRecord, LocalDb, StoreName, newId } from './local-db';

/**
 * Coleção persistida por conta, exposta como signal. A tela lê `items()`; as
 * escritas atualizam o signal na hora e gravam no banco local em seguida.
 */
export abstract class Collection<T extends DbRecord> {
  private readonly db = inject(LocalDb);
  protected readonly account = inject(AccountStore);
  private readonly _items = signal<T[]>([]);
  private loadToken = 0;

  readonly items = this._items.asReadonly();
  readonly loaded = signal(false);

  protected constructor(private readonly store: StoreName) {
    effect(() => {
      const accountId = this.account.selectedId();
      untracked(() => void this.load(accountId));
    });
  }

  private async load(accountId: string): Promise<void> {
    const token = ++this.loadToken;
    this.loaded.set(false);
    if (!accountId) {
      this._items.set([]);
      this.loaded.set(true);
      return;
    }
    const rows = await this.db.list<T>(this.store, accountId);
    if (token !== this.loadToken) return; // a conta mudou enquanto carregava
    this._items.set(rows);
    this.loaded.set(true);
  }

  async add(data: Omit<T, 'id' | 'accountId'>): Promise<T> {
    const record = { ...data, id: newId(), accountId: this.account.selectedId() } as T;
    this._items.update((list) => [...list, record]);
    await this.db.put(this.store, record);
    return record;
  }

  async upsert(record: T): Promise<void> {
    this._items.update((list) => {
      const idx = list.findIndex((r) => r.id === record.id);
      if (idx === -1) return [...list, record];
      const copy = list.slice();
      copy[idx] = record;
      return copy;
    });
    await this.db.put(this.store, record);
  }

  async upsertMany(records: readonly T[]): Promise<void> {
    if (!records.length) return;
    const incoming = new Map(records.map((r) => [r.id, r]));
    this._items.update((list) => {
      const kept = list.filter((r) => !incoming.has(r.id));
      return [...kept, ...records];
    });
    await this.db.putMany(this.store, records);
  }

  async remove(id: string): Promise<void> {
    this._items.update((list) => list.filter((r) => r.id !== id));
    await this.db.remove(this.store, id);
  }

  async clear(): Promise<void> {
    this._items.set([]);
    await this.db.clear(this.store, this.account.selectedId());
  }
}

@Injectable({ providedIn: 'root' })
export class LeadsStore extends Collection<Lead> {
  constructor() {
    super('leads');
  }

  /** Importa leads sem duplicar os que já existem (mesmo `externalId`). */
  async importMany(rows: ReadonlyArray<Omit<Lead, 'id' | 'accountId'>>): Promise<{ added: number; updated: number }> {
    const accountId = this.account.selectedId();
    const byExternal = new Map(
      this.items()
        .filter((l) => l.externalId)
        .map((l) => [l.externalId as string, l]),
    );
    let added = 0;
    let updated = 0;
    const toSave: Lead[] = rows.map((row) => {
      const existing = row.externalId ? byExternal.get(row.externalId) : undefined;
      if (existing) {
        updated++;
        return { ...existing, ...row, id: existing.id, accountId };
      }
      added++;
      return { ...row, id: newId(), accountId };
    });
    await this.upsertMany(toSave);
    return { added, updated };
  }
}

@Injectable({ providedIn: 'root' })
export class ContentStore extends Collection<ContentItem> {
  constructor() {
    super('content');
  }
}

@Injectable({ providedIn: 'root' })
export class QuestionsStore extends Collection<SupportQuestion> {
  constructor() {
    super('questions');
  }
}

@Injectable({ providedIn: 'root' })
export class HypothesesStore extends Collection<Hypothesis> {
  constructor() {
    super('hypotheses');
  }
}

@Injectable({ providedIn: 'root' })
export class LearningsStore extends Collection<Learning> {
  constructor() {
    super('learnings');
  }
}

@Injectable({ providedIn: 'root' })
export class ChangesStore extends Collection<ChangeEntry> {
  constructor() {
    super('changes');
  }

  /** Chave estável de um evento do Google Ads, para não duplicar ao reimportar. */
  static keyOf(c: GoogleAdsChange): string {
    return [c.at, c.resourceType, c.operation, c.campaignId ?? '', c.adGroupId ?? '', c.changedFields.join(',')].join('|');
  }

  /**
   * O Google Ads só guarda 30 dias de histórico. Guardamos cada evento localmente
   * na primeira vez que o vemos, e o histórico cresce além desse limite.
   */
  async importGoogleChanges(changes: readonly GoogleAdsChange[]): Promise<number> {
    const known = new Set(this.items().map((c) => c.externalKey).filter(Boolean));
    const accountId = this.account.selectedId();
    const fresh: ChangeEntry[] = [];
    for (const c of changes) {
      const key = ChangesStore.keyOf(c);
      if (known.has(key)) continue;
      known.add(key);
      fresh.push({
        id: newId(),
        accountId,
        at: c.at.replace(' ', 'T'),
        kind: googleKind(c.resourceType),
        title: googleTitle(c),
        description: c.changedFields.length ? `Campos alterados: ${c.changedFields.join(', ')}` : undefined,
        source: 'GOOGLE_ADS',
        author: c.userEmail || undefined,
        campaignId: c.campaignId,
        externalKey: key,
      });
    }
    await this.upsertMany(fresh);
    return fresh.length;
  }
}

@Injectable({ providedIn: 'root' })
export class RecStatesStore extends Collection<RecommendationState> {
  private readonly byRec = computed(() => {
    const map = new Map<string, RecommendationState>();
    for (const s of this.items()) map.set(s.id.split(':').slice(1).join(':'), s);
    return map;
  });

  constructor() {
    super('recstates');
  }

  statusOf(recId: string): RecommendationStatus {
    return this.byRec().get(recId)?.status ?? 'OPEN';
  }

  noteOf(recId: string): string | undefined {
    return this.byRec().get(recId)?.note;
  }

  async setStatus(recId: string, status: RecommendationStatus, note?: string): Promise<void> {
    const accountId = this.account.selectedId();
    await this.upsert({
      id: `${accountId}:${recId}`,
      accountId,
      status,
      note,
      updatedAt: new Date().toISOString(),
    });
  }
}

function googleKind(resourceType: string): ChangeEntry['kind'] {
  switch (resourceType) {
    case 'CAMPAIGN':
    case 'CAMPAIGN_BUDGET':
    case 'CAMPAIGN_CRITERION':
      return resourceType === 'CAMPAIGN_CRITERION' ? 'NEGATIVE' : 'CAMPAIGN';
    case 'AD_GROUP_CRITERION':
      return 'KEYWORD';
    case 'AD_GROUP_AD':
    case 'AD_GROUP':
      return 'AD';
    default:
      return 'OTHER';
  }
}

const RESOURCE_LABEL: Record<string, string> = {
  CAMPAIGN: 'campanha',
  CAMPAIGN_BUDGET: 'orçamento da campanha',
  CAMPAIGN_CRITERION: 'critério da campanha (ex.: palavra negativa, local)',
  AD_GROUP: 'grupo de anúncios',
  AD_GROUP_AD: 'anúncio',
  AD_GROUP_CRITERION: 'palavra-chave do grupo',
  AD_GROUP_BID_MODIFIER: 'ajuste de lance',
  ASSET: 'recurso (asset)',
  CUSTOMER_ASSET: 'recurso da conta',
};

const OPERATION_LABEL: Record<string, string> = {
  CREATE: 'Criou',
  UPDATE: 'Alterou',
  REMOVE: 'Removeu',
};

function googleTitle(c: GoogleAdsChange): string {
  const op = OPERATION_LABEL[c.operation] ?? c.operation;
  const what = RESOURCE_LABEL[c.resourceType] ?? c.resourceType.toLowerCase();
  return `${op} ${what}`;
}
