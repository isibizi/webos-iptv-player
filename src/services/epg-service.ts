import type { Channel, EpgChannel, Programme } from '../types';
import { parseXMLTV } from '../parsers/xmltv-parser';
import { fetchText } from '../utils/fetch-helper';
import { StorageService } from './storage-service';

class EpgServiceImpl {
  channels: Record<string, EpgChannel> = {};
  programmes: Record<string, Programme[]> = {};
  loaded = false;

  async load(): Promise<void> {
    return this.refresh();
  }

  async refresh(): Promise<void> {
    const url = StorageService.getEpgUrl();
    if (!url) return;

    try {
      const text = await fetchText(url, 120000);
      const result = parseXMLTV(text);
      this.channels = result.channels;
      this.programmes = result.programmes;
      this.loaded = true;
    } catch (err) {
      console.error('Failed to load EPG:', err);
    }
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
