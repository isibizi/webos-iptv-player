import type { Channel } from '../types';
import { parseM3U } from '../parsers/m3u-parser';
import { fetchText } from '../utils/fetch-helper';
import { createLogger } from '../utils/logger';
import { StorageService } from './storage-service';

const log = createLogger('Playlist');

class PlaylistServiceImpl {
  channels: Channel[] = [];
  groups: string[] = [];
  playlistNames: string[] = [];
  epgUrls: string[] = [];
  private indexMap = new Map<Channel, number>(); // channel -> global index, O(1) indexOf

  /**
   * Clear all in-memory state. Called when the user removes every configured
   * playlist so stale channels do not survive navigation back to the channel
   * list view.
   */
  reset(): void {
    this.channels = [];
    this.groups = [];
    this.playlistNames = [];
    this.epgUrls = [];
    this.indexMap = new Map();
  }

  async load(): Promise<Channel[]> {
    const cached = StorageService.getCachedPlaylist();
    if (cached) {
      this.channels = cached.channels;
      this.epgUrls = cached.epgUrls ?? [];
      log.info('Cache hit:', this.channels.length, 'channels,', this.epgUrls.length, 'epg urls');
      this.buildGroups();
      this.buildPlaylistNames();
      return this.channels;
    }
    log.info('Cache miss — refreshing from network');
    return this.refresh();
  }

  async refresh(): Promise<Channel[]> {
    const done = log.time('refresh');
    const playlists = StorageService.getPlaylists();
    if (!playlists.length) {
      log.warn('No playlists configured');
      done();
      return [];
    }

    const allChannels: Channel[] = [];
    const seenUrls = new Set<string>();
    const epgUrls: string[] = [];

    for (const pl of playlists) {
      const plDone = log.time(`fetch '${pl.name || pl.url}'`);
      try {
        const text = await fetchText(pl.url, 60000);
        log.info('Fetched', pl.name || pl.url, '|', text.length, 'bytes');
        const parsed = parseM3U(text);
        log.info('Parsed', parsed.channels.length, 'channels,', parsed.groups.length, 'groups',
          parsed.epgUrl ? `| epg: ${parsed.epgUrl}` : '');
        let added = 0, dupes = 0;
        for (const ch of parsed.channels) {
          if (!seenUrls.has(ch.url)) {
            seenUrls.add(ch.url);
            ch.playlist = pl.name || pl.url;
            allChannels.push(ch);
            added++;
          } else {
            dupes++;
          }
        }
        log.debug(`Added ${added} channels (${dupes} duplicates skipped)`);
        if (parsed.epgUrl) {
          // Resolve localhost/127.0.0.1 in embedded EPG URL to the playlist's host
          let epg = parsed.epgUrl;
          try {
            const epgParsed = new URL(epg);
            if (epgParsed.hostname === 'localhost' || epgParsed.hostname === '127.0.0.1') {
              const plParsed = new URL(pl.url);
              epgParsed.hostname = plParsed.hostname;
              epg = epgParsed.toString();
              log.info('Rewrote loopback EPG host to', epgParsed.hostname);
            }
          } catch (e) { log.warn('Could not parse EPG URL:', epg, e); }
          if (!epgUrls.includes(epg)) epgUrls.push(epg);
        }
      } catch (err) {
        log.error(`Failed to load playlist '${pl.name || pl.url}':`, err);
      }
      plDone();
    }

    this.channels = allChannels;
    this.epgUrls = epgUrls;
    this.buildGroups();
    this.buildPlaylistNames();
    StorageService.setCachedPlaylist(allChannels, epgUrls);
    log.info('Refresh complete:', allChannels.length, 'total channels,', epgUrls.length, 'epg urls');
    done();
    return allChannels;
  }

  private buildGroups(): void {
    const groupSet = new Set<string>();
    this.indexMap = new Map();
    for (let i = 0; i < this.channels.length; i++) {
      const ch = this.channels[i];
      this.indexMap.set(ch, i);
      if (ch.group) groupSet.add(ch.group);
    }
    this.groups = Array.from(groupSet);
  }

  private buildPlaylistNames(): void {
    const nameSet = new Set<string>();
    for (const ch of this.channels) {
      if (ch.playlist) nameSet.add(ch.playlist);
    }
    this.playlistNames = Array.from(nameSet);
  }

  getByGroup(group: string, playlist?: string): Channel[] {
    let filtered = this.channels;
    if (playlist) {
      filtered = filtered.filter(ch => ch.playlist === playlist);
    }
    if (!group || group === 'All') return filtered;
    if (group === 'Favorites') {
      const favs = StorageService.getFavorites();
      return filtered.filter(ch => favs.includes(ch.id || ch.name));
    }
    return filtered.filter(ch => ch.group === group);
  }

  /** Case-insensitive name search, optionally scoped to one playlist. Empty query → []. */
  search(query: string, playlist?: string): Channel[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pool = playlist ? this.channels.filter(ch => ch.playlist === playlist) : this.channels;
    return pool.filter(ch => ch.name.toLowerCase().includes(q));
  }

  getGroupsForPlaylist(playlist?: string): string[] {
    const channels = playlist
      ? this.channels.filter(ch => ch.playlist === playlist)
      : this.channels;
    const groupSet = new Set<string>();
    for (const ch of channels) {
      if (ch.group) groupSet.add(ch.group);
    }
    return Array.from(groupSet);
  }

  getByIndex(index: number): Channel | null {
    return this.channels[index] ?? null;
  }

  indexOf(channel: Channel): number {
    return this.indexMap.get(channel) ?? -1;
  }
}

export const PlaylistService = new PlaylistServiceImpl();
