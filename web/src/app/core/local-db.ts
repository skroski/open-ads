import { Injectable, signal } from '@angular/core';

export type StoreName =
  | 'leads'
  | 'content'
  | 'changes'
  | 'hypotheses'
  | 'learnings'
  | 'recstates'
  | 'questions';

const STORE_NAMES: readonly StoreName[] = [
  'leads',
  'content',
  'changes',
  'hypotheses',
  'learnings',
  'recstates',
  'questions',
];
const DB_NAME = 'gads-intel';
const DB_VERSION = 2;

export interface DbRecord {
  id: string;
  accountId: string;
}

/**
 * Armazenamento local (IndexedDB) por conta. O histórico de mudanças e os leads
 * importados passam fácil dos ~5 MB do localStorage, então coleções grandes vivem aqui.
 *
 * Todos os métodos são assíncronos de propósito: trocar por um backend remoto
 * (ex.: Supabase) significa reimplementar esta classe, sem mexer nas telas.
 *
 * Se o IndexedDB não estiver disponível (navegação privada, política da empresa),
 * os dados ficam só em memória e `persistent` passa a ser false.
 */
@Injectable({ providedIn: 'root' })
export class LocalDb {
  readonly persistent = signal(true);

  private opening: Promise<IDBDatabase | null> | null = null;
  private readonly memory = new Map<StoreName, Map<string, DbRecord>>();

  private open(): Promise<IDBDatabase | null> {
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        this.persistent.set(false);
        resolve(null);
        return;
      }
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const name of STORE_NAMES) {
            if (!db.objectStoreNames.contains(name)) {
              const store = db.createObjectStore(name, { keyPath: 'id' });
              store.createIndex('accountId', 'accountId', { unique: false });
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.persistent.set(false);
          resolve(null);
        };
        request.onblocked = () => {
          this.persistent.set(false);
          resolve(null);
        };
      } catch {
        this.persistent.set(false);
        resolve(null);
      }
    });
    return this.opening;
  }

  private mem(store: StoreName): Map<string, DbRecord> {
    let m = this.memory.get(store);
    if (!m) {
      m = new Map();
      this.memory.set(store, m);
    }
    return m;
  }

  private tx<T>(
    db: IDBDatabase,
    store: StoreName,
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T> | void,
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = run(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request ? (request.result as T) : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async list<T extends DbRecord>(store: StoreName, accountId: string): Promise<T[]> {
    const db = await this.open();
    if (!db) return Array.from(this.mem(store).values()).filter((r) => r.accountId === accountId) as T[];
    const result = await this.tx<T[]>(db, store, 'readonly', (s) => s.index('accountId').getAll(accountId));
    return result ?? [];
  }

  async put<T extends DbRecord>(store: StoreName, record: T): Promise<void> {
    await this.putMany(store, [record]);
  }

  async putMany<T extends DbRecord>(store: StoreName, records: readonly T[]): Promise<void> {
    if (!records.length) return;
    const db = await this.open();
    if (!db) {
      const m = this.mem(store);
      records.forEach((r) => m.set(r.id, r));
      return;
    }
    await this.tx<void>(db, store, 'readwrite', (s) => {
      records.forEach((r) => s.put(r));
    });
  }

  async remove(store: StoreName, id: string): Promise<void> {
    const db = await this.open();
    if (!db) {
      this.mem(store).delete(id);
      return;
    }
    await this.tx<void>(db, store, 'readwrite', (s) => {
      s.delete(id);
    });
  }

  async clear(store: StoreName, accountId: string): Promise<void> {
    const existing = await this.list<DbRecord>(store, accountId);
    const db = await this.open();
    if (!db) {
      const m = this.mem(store);
      existing.forEach((r) => m.delete(r.id));
      return;
    }
    await this.tx<void>(db, store, 'readwrite', (s) => {
      existing.forEach((r) => s.delete(r.id));
    });
  }
}

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
