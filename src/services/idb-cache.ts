import type { ParsedEpg } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('IDB');
const DB_NAME = 'iptv';
const DB_VERSION = 1;
const STORE = 'epg-cache';

export interface CachedEpgEntry {
  url: string;
  timestamp: number;
  data: ParsedEpg;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      log.warn('IndexedDB unavailable');
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      log.warn('Open failed:', req.error);
      resolve(null);
    };
    req.onblocked = () => {
      log.warn('Open blocked');
      resolve(null);
    };
  });
  return dbPromise;
}

export async function getCachedEpg(url: string): Promise<CachedEpgEntry | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve((req.result as CachedEpgEntry | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch (err) {
      log.warn('Read failed:', err);
      resolve(null);
    }
  });
}

export async function setCachedEpg(url: string, data: ParsedEpg): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ url, timestamp: Date.now(), data } satisfies CachedEpgEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => { log.warn('Write failed:', tx.error); resolve(); };
      tx.onabort = () => { log.warn('Write aborted:', tx.error); resolve(); };
    } catch (err) {
      log.warn('Write failed:', err);
      resolve();
    }
  });
}

export async function clearCachedEpg(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
