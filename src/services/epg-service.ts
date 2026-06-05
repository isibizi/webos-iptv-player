import type { Channel, EpgChannel, Programme } from '../types';
import { parseXMLTV } from '../parsers/xmltv-parser';
import { fetchText } from '../utils/fetch-helper';
import { createLogger } from '../utils/logger';
import { CONFIG } from '../config';
import { StorageService } from './storage-service';
import { getCachedEpg, setCachedEpg } from './idb-cache';

const log = createLogger('EPG');

class EpgServiceImpl {
  channels: Record<string, EpgChannel> = {};
  programmes: Record<string, Programme[]> = {};
  loaded = false;
  private lastFetchTime = 0;

  /**
   * Clear all in-memory state. Called when the user removes every configured
   * playlist so stale programme data does not survive a reload.
   */
  reset(): void {
    this.channels = {};
    this.programmes = {};
    this.loaded = false;
    this.lastFetchTime = 0;
  }

  async load(): Promise<void> {
    const url = StorageService.getEpgUrl();
    if (!url) {
      log.warn('No EPG URL — skipping load');
      return;
    }

    try {
      const cached = await getCachedEpg(url);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < CONFIG.EPG_REFRESH_INTERVAL) {
          this.channels = cached.data.channels;
          this.programmes = cached.data.programmes;
          this.loaded = true;
          this.lastFetchTime = cached.timestamp;
          log.info('Loaded from IDB cache:',
            Object.keys(cached.data.channels).length, 'channels,',
            Object.keys(cached.data.programmes).length, 'with programmes, age',
            Math.round(age / 60000), 'min');
          return;
        }
        log.info('Cache stale (age', Math.round(age / 60000), 'min) — refreshing');
      }
    } catch (err) {
      log.warn('Cache read failed:', err);
    }

    return this.refresh();
  }

  async refresh(): Promise<void> {
    const url = StorageService.getEpgUrl();
    if (!url) {
      log.warn('No EPG URL — skipping refresh');
      return;
    }

    if (this.loaded && Date.now() - this.lastFetchTime < CONFIG.EPG_REFRESH_INTERVAL) {
      log.info('Skipping refresh — data is fresh');
      return;
    }

    const done = log.time('refresh');
    log.info('Fetching EPG from', url);
    try {
      const text = await fetchText(url, 120000);
      log.info('Fetched EPG:', text.length, 'bytes');
      const parseDone = log.time('parse');
      const result = parseXMLTV(text);
      parseDone();
      this.channels = result.channels;
      this.programmes = result.programmes;
      this.loaded = true;
      this.lastFetchTime = Date.now();
      log.info('Loaded', Object.keys(result.channels).length, 'channels,',
        Object.keys(result.programmes).length, 'channels with programmes');

      setCachedEpg(url, result).catch(err => log.warn('Cache write failed:', err));
    } catch (err) {
      log.error('Failed to load EPG:', err);
    }
    done();
  }

  getNowPlaying(channelId: string): Programme | null {
    const progs = this.programmes[channelId];
    if (!progs) return null;
    const now = Date.now();
    return progs.find(p => p.start.getTime() <= now && p.stop.getTime() > now) ?? null;
  }

  getUpcoming(channelId: string, count = 5): Programme[] {
    const progs = this.programmes[channelId];
    if (!progs) return [];
    const now = Date.now();
    return progs.filter(p => p.start.getTime() > now).slice(0, count);
  }

  getProgrammesInRange(channelId: string, startTime: Date, endTime: Date): Programme[] {
    const progs = this.programmes[channelId];
    if (!progs) return [];
    return progs.filter(p =>
      p.stop.getTime() > startTime.getTime() && p.start.getTime() < endTime.getTime()
    );
  }

  findChannelId(m3uChannel: Channel): string | null {
    if (m3uChannel.id && this.programmes[m3uChannel.id]) {
      return m3uChannel.id;
    }
    for (const [id, ch] of Object.entries(this.channels)) {
      if (ch.name && ch.name.toLowerCase() === m3uChannel.name.toLowerCase()) {
        return id;
      }
    }
    return null;
  }
}

export const EpgService = new EpgServiceImpl();
