/**
 * Leitura do armazenamento local (IndexedDB) por conta. Usa o MESMO banco e os mesmos
 * stores do painel Angular (`gads-intel`, versão 2), então os dados já salvos aparecem aqui.
 * Nesta etapa só lê: as telas portadas ainda não gravam.
 */

export type StoreName = 'leads' | 'content' | 'changes' | 'hypotheses' | 'learnings' | 'recstates' | 'questions';

const STORE_NAMES: readonly StoreName[] = ['leads', 'content', 'changes', 'hypotheses', 'learnings', 'recstates', 'questions'];
const DB_NAME = 'gads-intel';
const DB_VERSION = 2;

export interface DbRecord {
  id: string;
  accountId: string;
}

let opening: Promise<IDBDatabase | null> | null = null;
let persistent = true;

export const isPersistent = (): boolean => persistent;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      persistent = false;
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
        persistent = false;
        resolve(null);
      };
      request.onblocked = () => {
        persistent = false;
        resolve(null);
      };
    } catch {
      persistent = false;
      resolve(null);
    }
  });
  return opening;
}

export async function listRecords<T extends DbRecord>(store: StoreName, accountId: string): Promise<T[]> {
  const db = await open();
  if (!db) return [];
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).index('accountId').getAll(accountId);
    tx.oncomplete = () => resolve((request.result as T[]) ?? []);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
