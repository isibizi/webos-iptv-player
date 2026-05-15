import { CONFIG } from '../config';
import type { Channel, PlaylistEntry } from '../types';

const PREFIX = CONFIG.STORAGE_PREFIX;

function get<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function set(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    evictCache();
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}

function remove(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

function evictCache(): void {
  remove('cached_playlist');
}

export const StorageService = {
  get,
  set,
  remove,

  getPlaylists(): PlaylistEntry[] {
    return get<PlaylistEntry[]>('playlists', []);
  },
  setPlaylists(playlists: PlaylistEntry[]): void {
    set('playlists', playlists);
  },

  getEpgUrl(): string {
    return get<string>('epg_url', '');
  },
  setEpgUrl(url: string): void {
    set('epg_url', url);
  },

  getLastChannel(): number {
    return get<number>('last_channel', 0);
  },
  setLastChannel(index: number): void {
    set('last_channel', index);
  },

  getFavorites(): string[] {
    return get<string[]>('favorites', []);
  },
  setFavorites(favs: string[]): void {
    set('favorites', favs);
  },

  toggleFavorite(channelId: string): boolean {
    const favs = this.getFavorites();
    const idx = favs.indexOf(channelId);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(channelId);
    }
    this.setFavorites(favs);
    return idx < 0; // true = added
  },

  getAutoPlay(): boolean {
    return get<boolean>('auto_play', false);
  },
  setAutoPlay(val: boolean): void {
    set('auto_play', val);
  },

  getCachedPlaylist(): { channels: Channel[]; epgUrls: string[] } | null {
    const data = get<{ channels: Channel[]; epgUrls?: string[]; timestamp: number } | null>('cached_playlist', null);
    if (!data || Date.now() - data.timestamp > CONFIG.PLAYLIST_REFRESH_INTERVAL) return null;
    if (!data.channels || data.channels.length === 0) return null;
    return { channels: data.channels, epgUrls: data.epgUrls ?? [] };
  },
  setCachedPlaylist(channels: Channel[], epgUrls: string[] = []): void {
    if (!channels.length) return;
    set('cached_playlist', { channels, epgUrls, timestamp: Date.now() });
  },

};
