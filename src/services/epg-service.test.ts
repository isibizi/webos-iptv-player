import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EpgService } from './epg-service';
import type { Channel, Programme } from '../types';

function prog(over: Partial<Programme>): Programme {
  return {
    start: new Date(0), stop: new Date(0),
    title: '', description: '', category: '', icon: '', ...over,
  };
}

function channel(over: Partial<Channel>): Channel {
  return {
    id: '', name: '', logo: '', group: '', url: '', extras: null,
    playlist: '', catchup: '', catchupSource: '', catchupDays: 0, ...over,
  };
}

const NOON = new Date('2024-06-01T12:00:00Z').getTime();
const h = (n: number) => new Date(NOON + n * 3600_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  EpgService.channels = {};
  EpgService.programmes = {};
  EpgService.loaded = false;
});

afterEach(() => vi.useRealTimers());

describe('EpgService.getNowPlaying', () => {
  it('returns the programme currently airing', () => {
    EpgService.programmes = {
      ch1: [
        prog({ title: 'Past', start: h(-2), stop: h(-1) }),
        prog({ title: 'Now', start: h(-1), stop: h(1) }),
        prog({ title: 'Next', start: h(1), stop: h(2) }),
      ],
    };
    expect(EpgService.getNowPlaying('ch1')?.title).toBe('Now');
  });

  it('returns null when nothing is airing or the channel is unknown', () => {
    EpgService.programmes = { ch1: [prog({ start: h(1), stop: h(2) })] };
    expect(EpgService.getNowPlaying('ch1')).toBeNull();
    expect(EpgService.getNowPlaying('missing')).toBeNull();
  });
});

describe('EpgService.getUpcoming', () => {
  it('returns future programmes capped at the requested count', () => {
    EpgService.programmes = {
      ch1: [
        prog({ title: 'Now', start: h(-1), stop: h(1) }),
        prog({ title: 'A', start: h(1), stop: h(2) }),
        prog({ title: 'B', start: h(2), stop: h(3) }),
        prog({ title: 'C', start: h(3), stop: h(4) }),
      ],
    };
    expect(EpgService.getUpcoming('ch1', 2).map(p => p.title)).toEqual(['A', 'B']);
  });

  it('returns an empty array for an unknown channel', () => {
    expect(EpgService.getUpcoming('missing')).toEqual([]);
  });
});

describe('EpgService.getProgrammesInRange', () => {
  it('returns programmes that overlap the window', () => {
    EpgService.programmes = {
      ch1: [
        prog({ title: 'Before', start: h(-5), stop: h(-4) }),
        prog({ title: 'Overlap-start', start: h(-1), stop: h(1) }),
        prog({ title: 'Inside', start: h(1), stop: h(2) }),
        prog({ title: 'After', start: h(5), stop: h(6) }),
      ],
    };
    const result = EpgService.getProgrammesInRange('ch1', h(0), h(3)).map(p => p.title);
    expect(result).toEqual(['Overlap-start', 'Inside']);
  });
});

describe('EpgService.findChannelId', () => {
  it('matches by tvg-id when programmes exist for it', () => {
    EpgService.programmes = { 'tvg.1': [prog({})] };
    expect(EpgService.findChannelId(channel({ id: 'tvg.1', name: 'Alpha' }))).toBe('tvg.1');
  });

  it('falls back to a case-insensitive name match against EPG channels', () => {
    EpgService.channels = { 'epg.5': { name: 'Alpha HD', icon: '' } };
    expect(EpgService.findChannelId(channel({ id: '', name: 'alpha hd' }))).toBe('epg.5');
  });

  it('returns null when neither id nor name matches', () => {
    EpgService.channels = { 'epg.5': { name: 'Beta', icon: '' } };
    expect(EpgService.findChannelId(channel({ id: 'x', name: 'Alpha' }))).toBeNull();
  });
});
