import type { Channel } from '../types';
import { parseM3U } from '../parsers/m3u-parser';
import { fetchText } from '../utils/fetch-helper';
import { StorageService } from './storage-service';

class PlaylistServiceImpl {
  channels: Channel[] = [];
  groups: string[] = [];
  playlistNames: string[] = [];
  epgUrls: string[] = [];

  async load(): Promise<Channel[]> {
    const cached = StorageService.getCachedPlaylist();
    if (cached) {
      this.channels = cached;
      this.buildGroups();
      this.buildPlaylistNames();
      return this.channels;
    }
    return this.refresh();
  }

  async refresh(): Promise<Channel[]> {
    const playlists = StorageService.getPlaylists();
    if (!playlists.length) return [];

    const allChannels: Channel[] = [];
    const seenUrls = new Set<string>();
    const epgUrls: string[] = [];

    for (const pl of playlists) {
      try {
        const text = await fetchText(pl.url, 60000);
        const parsed = parseM3U(text);
        for (const ch of parsed.channels) {
          if (!seenUrls.has(ch.url)) {
            seenUrls.add(ch.url);
            ch.playlist = pl.name || pl.url;
            allChannels.push(ch);
          }
        }
        if (parsed.epgUrl) {
          // Resolve localhost/127.0.0.1 in embedded EPG URL to the playlist's host
          let epg = parsed.epgUrl;
          try {
            const epgParsed = new URL(epg);
            if (epgParsed.hostname === 'localhost' || epgParsed.hostname === '127.0.0.1') {
              const plParsed = new URL(pl.url);
              epgParsed.hostname = plParsed.hostname;
              epg = epgParsed.toString();
            }
          } catch { /* keep original */ }
          if (!epgUrls.includes(epg)) epgUrls.push(epg);
        }
      } catch (err) {
        console.error(`Failed to load playlist ${pl.name}:`, err);
      }
    }

    this.channels = allChannels;
    this.epgUrls = epgUrls;
    this.buildGroups();
    this.buildPlaylistNames();
    StorageService.setCachedPlaylist(allChannels);
    return allChannels;
  }

  private buildGroups(): void {
    const groupSet = new Set<string>();
    for (const ch of this.channels) {
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
    return this.channels.indexOf(channel);
  }
}

export const PlaylistService = new PlaylistServiceImpl();
