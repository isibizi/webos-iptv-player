import type { PlaylistEntry, VodCategory, VodItem, VodInfo, SeriesCategory, SeriesItem, SeriesInfo } from '../types';
import { createXtreamClient } from './xtream-client';
import { getCachedCatalog, setCachedCatalog } from './idb-cache';
import { CONFIG } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('Catalog');

// Per-account cached catalog access. Categories are cheap and fetched up front;
// streams are fetched per category on demand. Each result is cached in
// IndexedDB (keyed `${accountId}|action[|param]`) and served while within TTL.
// On a failed/empty re-fetch we keep serving the stale copy rather than a blank.

function clientFor(a: PlaylistEntry) {
  return createXtreamClient(
    { baseUrl: a.url, username: a.xtream!.username, password: a.xtream!.password },
    a.id,
  );
}

function fresh(timestamp: number): boolean {
  return Date.now() - timestamp < CONFIG.XTREAM.CATALOG_TTL_MS;
}

// Serve a fresh cache hit; otherwise re-fetch a list, caching a non-empty result
// and falling back to the stale copy on an empty/failed re-fetch (logged, since
// the fallback is otherwise invisible — the caller just sees old data).
async function cachedList<T>(key: string, refetch: () => Promise<T[]>): Promise<T[]> {
  const cached = await getCachedCatalog<T[]>(key);
  if (cached && fresh(cached.timestamp)) { log.debug('hit', key, `(${cached.data.length})`); return cached.data; }
  const data = await refetch();
  if (data.length) { await setCachedCatalog(key, data); log.debug('fetched', key, `(${data.length})`); return data; }
  if (cached) { log.warn('empty re-fetch — serving stale', key, `(${cached.data.length})`); return cached.data; }
  log.warn('empty result and no cache', key);
  return data;
}

// Single-object variant of cachedList: caches a truthy result, otherwise serves
// the stale copy (or null) on an empty/failed re-fetch.
async function cachedItem<T>(key: string, refetch: () => Promise<T | null>): Promise<T | null> {
  const cached = await getCachedCatalog<T>(key);
  if (cached && fresh(cached.timestamp)) { log.debug('hit', key); return cached.data; }
  const data = await refetch();
  if (data) { await setCachedCatalog(key, data); log.debug('fetched', key); return data; }
  if (cached) { log.warn('empty re-fetch — serving stale', key); return cached.data; }
  log.warn('empty result and no cache', key);
  return null;
}

export function loadVodCategories(account: PlaylistEntry): Promise<VodCategory[]> {
  return cachedList(`${account.id}|vod_categories`, () => clientFor(account).getVodCategories());
}

export function loadVodStreams(account: PlaylistEntry, categoryId: string): Promise<VodItem[]> {
  return cachedList(`${account.id}|vod_streams|${categoryId}`, () => clientFor(account).getVodStreams(categoryId));
}

export function loadVodInfo(account: PlaylistEntry, vodId: string): Promise<VodInfo | null> {
  return cachedItem(`${account.id}|vod_info|${vodId}`, () => clientFor(account).getVodInfo(vodId));
}

export function loadSeriesCategories(account: PlaylistEntry): Promise<SeriesCategory[]> {
  return cachedList(`${account.id}|series_categories`, () => clientFor(account).getSeriesCategories());
}

export function loadSeries(account: PlaylistEntry, categoryId: string): Promise<SeriesItem[]> {
  return cachedList(`${account.id}|series|${categoryId}`, () => clientFor(account).getSeries(categoryId));
}

export function loadSeriesInfo(account: PlaylistEntry, seriesId: string): Promise<SeriesInfo | null> {
  return cachedItem(`${account.id}|series_info|${seriesId}`, () => clientFor(account).getSeriesInfo(seriesId));
}

export function loadAllVodStreams(account: PlaylistEntry): Promise<VodItem[]> {
  return cachedList(`${account.id}|vod_all`, () => clientFor(account).getVodStreams());
}

export function loadAllSeries(account: PlaylistEntry): Promise<SeriesItem[]> {
  return cachedList(`${account.id}|series_all`, () => clientFor(account).getSeries());
}
