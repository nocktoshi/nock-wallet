/** IndexedDB persistence for the single wallet record (encrypted vault + meta). */
import type { StoredWallet } from "./types.js";

const DB_NAME = "rose-web";
const DB_VERSION = 1;
const STORE = "wallet";
const KEY = "default";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB tx failed"));
        t.oncomplete = () => db.close();
      })
  );
}

export async function loadStoredWallet(): Promise<StoredWallet | null> {
  const v = await tx<StoredWallet | undefined>("readonly", (s) => s.get(KEY));
  return v ?? null;
}

export function saveStoredWallet(w: StoredWallet): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(w, KEY));
}

export function clearStoredWallet(): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(KEY));
}

export async function hasStoredWallet(): Promise<boolean> {
  return (await loadStoredWallet()) !== null;
}
