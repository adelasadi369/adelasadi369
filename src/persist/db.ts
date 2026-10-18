import type { PrinterPreset, VaseParams } from '../core/params/schema';

/** Tiny IndexedDB wrapper for saved designs and calibrated printer profiles (no dependency). */
export interface SavedDesign {
  id: string;
  name: string;
  params: VaseParams;
  thumbnail?: string;
  updatedAt: number;
}

/** User-calibrated values for a printer preset; overrides the PRINTER_PRESETS defaults. */
export interface PrinterProfile {
  id: PrinterPreset;
  holeCompensation: number;
  updatedAt: number;
}

const DB = 'vaseforge';
const DESIGNS = 'designs';
const PRINTERS = 'printers';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(DESIGNS)) req.result.createObjectStore(DESIGNS, { keyPath: 'id' });
      if (!names.contains(PRINTERS)) req.result.createObjectStore(PRINTERS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const listDesigns = async () =>
  ((await tx<SavedDesign[]>(DESIGNS, 'readonly', (s) => s.getAll() as IDBRequest<SavedDesign[]>)) ?? []).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
export const saveDesign = (d: SavedDesign) => tx(DESIGNS, 'readwrite', (s) => s.put(d));
export const deleteDesign = (id: string) => tx(DESIGNS, 'readwrite', (s) => s.delete(id));

export const listPrinterProfiles = async () =>
  (await tx<PrinterProfile[]>(PRINTERS, 'readonly', (s) => s.getAll() as IDBRequest<PrinterProfile[]>)) ?? [];
export const savePrinterProfile = (p: PrinterProfile) => tx(PRINTERS, 'readwrite', (s) => s.put(p));
