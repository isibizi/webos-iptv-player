import type { PlaylistEntry, VodCategory, VodItem, VodInfo, SeriesCategory, SeriesItem, SeriesInfo } from '../types';
import { createXtreamClient } from './xtream-client';
import { getCachedCatalog, setCachedCatalog } from './idb-cache';
import { CONFIG } from '../config';

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

export async function loadVodCategories(account: PlaylistEntry): Promise<VodCategory[]> {
  const key = `${account.id}|vod_categories`;
  const cached = await getCachedCatalog<VodCategory[]>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getVodCategories();
  if (data.length) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : data;
}

export async function loadVodStreams(account: PlaylistEntry, categoryId: string): Promise<VodItem[]> {
  const key = `${account.id}|vod_streams|${categoryId}`;
  const cached = await getCachedCatalog<VodItem[]>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getVodStreams(categoryId);
  if (data.length) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : data;
}

export async function loadVodInfo(account: PlaylistEntry, vodId: string): Promise<VodInfo | null> {
  const key = `${account.id}|vod_info|${vodId}`;
  const cached = await getCachedCatalog<VodInfo>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getVodInfo(vodId);
  if (data) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : null;
}

export async function loadSeriesCategories(account: PlaylistEntry): Promise<SeriesCategory[]> {
  const key = `${account.id}|series_categories`;
  const cached = await getCachedCatalog<SeriesCategory[]>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getSeriesCategories();
  if (data.length) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : data;
}

export async function loadSeries(account: PlaylistEntry, categoryId: string): Promise<SeriesItem[]> {
  const key = `${account.id}|series|${categoryId}`;
  const cached = await getCachedCatalog<SeriesItem[]>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getSeries(categoryId);
  if (data.length) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : data;
}

export async function loadSeriesInfo(account: PlaylistEntry, seriesId: string): Promise<SeriesInfo | null> {
  const key = `${account.id}|series_info|${seriesId}`;
  const cached = await getCachedCatalog<SeriesInfo>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getSeriesInfo(seriesId);
  if (data) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : null;
}

export async function loadAllVodStreams(account: PlaylistEntry): Promise<VodItem[]> {
  const key = `${account.id}|vod_all`;
  const cached = await getCachedCatalog<VodItem[]>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getVodStreams();
  if (data.length) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : data;
}

export async function loadAllSeries(account: PlaylistEntry): Promise<SeriesItem[]> {
  const key = `${account.id}|series_all`;
  const cached = await getCachedCatalog<SeriesItem[]>(key);
  if (cached && fresh(cached.timestamp)) return cached.data;
  const data = await clientFor(account).getSeries();
  if (data.length) { await setCachedCatalog(key, data); return data; }
  return cached ? cached.data : data;
}
