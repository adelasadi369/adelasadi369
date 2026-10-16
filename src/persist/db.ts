import type { VaseParams } from '../core/params/schema';

/** Tiny IndexedDB wrapper for saved designs (no dependency). */
export interface SavedDesign {
  id: string;
  name: string;
  params: VaseParams;
  thumbnail?: string;
  updatedAt: number;
}

const DB = 'vaseforge';
const STORE = 'designs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const listDesigns = async () =>
  ((await tx<SavedDesign[]>('readonly', (s) => s.getAll() as IDBRequest<SavedDesign[]>)) ?? []).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
export const saveDesign = (d: SavedDesign) => tx('readwrite', (s) => s.put(d));
export const deleteDesign = (id: string) => tx('readwrite', (s) => s.delete(id));
