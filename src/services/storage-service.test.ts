// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { Channel } from '../types';
import { StorageService } from './storage-service';
import { channelKey } from '../utils/channel';

const ch = (over: Partial<Channel>): Channel => ({
  id: '', name: '', logo: '', group: '', url: '', extras: null,
  playlistIds: [], catchup: '', catchupSource: '', catchupDays: 0, ...over,
});

describe('StorageService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty playlist list by default', () => {
    expect(StorageService.getPlaylists()).toEqual([]);
  });

  it('round-trips playlists and backfills a stable id for legacy entries', () => {
    StorageService.setPlaylists([{ id: 'keep', name: 'A', url: 'http://a' }]);
    expect(StorageService.getPlaylists()).toEqual([{ id: 'keep', name: 'A', url: 'http://a' }]);

    // A playlist saved before stable ids existed (no id field) gets one
    // backfilled and persisted, so a second read returns the same id.
    StorageService.set('playlists', [{ name: 'B', url: 'http://b' }]);
    const got = StorageService.getPlaylists();
    expect(got).toEqual([{ name: 'B', url: 'http://b', id: expect.any(String) }]);
    expect(StorageService.getPlaylists()[0].id).toBe(got[0].id);
  });

  it('defaults the EPG url to an empty string and round-trips it', () => {
    expect(StorageService.getEpgUrl()).toBe('');
    StorageService.setEpgUrl('http://epg/guide.xml');
    expect(StorageService.getEpgUrl()).toBe('http://epg/guide.xml');
  });

  it('defaults reminders to an empty array and round-trips them', () => {
    expect(StorageService.getReminders()).toEqual([]);
    const list = [{ channelKey: 'k1', channelName: 'Chan A', title: 'Alpha', startMs: 100, stopMs: 200 }];
    StorageService.setReminders(list);
    expect(StorageService.getReminders()).toEqual(list);
  });

  it('toggles a favorite on and off, returning the new state', () => {
    expect(StorageService.getFavorites()).toEqual([]);
    expect(StorageService.toggleFavorite('chan-1')).toBe(true);
    expect(StorageService.getFavorites()).toContain('chan-1');
    expect(StorageService.toggleFavorite('chan-1')).toBe(false);
    expect(StorageService.getFavorites()).not.toContain('chan-1');
  });

  it('namespaces keys with the configured storage prefix', () => {
    StorageService.setEpgUrl('http://epg/x.xml');
    const prefixed = Object.keys(localStorage).filter(k => k.startsWith('iptv_'));
    expect(prefixed.length).toBeGreaterThan(0);
  });

  describe('favorite key migration', () => {
    it('re-keys legacy favorites (id||name) to channelKey, then is idempotent', () => {
      StorageService.setFavorites(['fav1', 'fav2']); // legacy keys
      const channels = [ch({ id: 'fav1', url: 'http://host/a' }), ch({ name: 'fav2', url: 'http://host/b' })];
      StorageService.migrateFavoriteKeys(channels);
      expect(StorageService.getFavorites()).toEqual([channelKey(channels[0]), channelKey(channels[1])]);

      // A second call must not touch favorites again (flag set).
      StorageService.setFavorites(['untouched']);
      StorageService.migrateFavoriteKeys(channels);
      expect(StorageService.getFavorites()).toEqual(['untouched']);
    });

    it('waits for channels before migrating (and does not set the flag)', () => {
      StorageService.setFavorites(['fav1']);
      StorageService.migrateFavoriteKeys([]); // no channels yet → no-op
      expect(StorageService.getFavorites()).toEqual(['fav1']);

      const channels = [ch({ id: 'fav1', url: 'http://host/a' })];
      StorageService.migrateFavoriteKeys(channels);
      expect(StorageService.getFavorites()).toEqual([channelKey(channels[0])]);
    });

    it('drops a legacy favorite whose channel is no longer present', () => {
      StorageService.setFavorites(['gone']);
      StorageService.migrateFavoriteKeys([ch({ id: 'fav1', url: 'http://host/a' })]);
      expect(StorageService.getFavorites()).toEqual([]);
    });
  });

  describe('audio preferences', () => {
    it('returns null when no choice is saved for a channel', () => {
      expect(StorageService.getAudioPref('ch1')).toBeNull();
    });

    it('remembers a choice per channel without bleeding across channels', () => {
      StorageService.setAudioPref('ch1', { name: 'Track 1', lang: 'l1' });
      StorageService.setAudioPref('ch2', { name: 'Track 2', lang: 'l2' });
      expect(StorageService.getAudioPref('ch1')).toEqual({ name: 'Track 1', lang: 'l1' });
      expect(StorageService.getAudioPref('ch2')).toEqual({ name: 'Track 2', lang: 'l2' });
      expect(StorageService.getAudioPref('ch3')).toBeNull();
    });

    it('persists through localStorage (survives a reload)', () => {
      StorageService.setAudioPref('ch1', { name: 'Track 2', lang: 'l1' });
      // A fresh read goes back to localStorage — no in-memory cache.
      expect(StorageService.getAudioPref('ch1')).toEqual({ name: 'Track 2', lang: 'l1' });
      expect(localStorage.getItem('iptv_audio_prefs')).toContain('Track 2');
    });

    it('ignores an empty channel id', () => {
      StorageService.setAudioPref('', { name: 'Track 1', lang: 'l1' });
      expect(StorageService.getAudioPref('')).toBeNull();
      expect(localStorage.getItem('iptv_audio_prefs')).toBeNull();
    });
  });

  describe('subtitle preferences', () => {
    it('returns null when no choice is saved for a channel', () => {
      expect(StorageService.getSubtitlePref('ch1')).toBeNull();
    });

    it('remembers a choice per channel, including an explicit off, without bleeding', () => {
      StorageService.setSubtitlePref('ch1', { off: false, name: 'Track 1', lang: 'l1' });
      StorageService.setSubtitlePref('ch2', { off: true, name: '', lang: '' });
      expect(StorageService.getSubtitlePref('ch1')).toEqual({ off: false, name: 'Track 1', lang: 'l1' });
      expect(StorageService.getSubtitlePref('ch2')).toEqual({ off: true, name: '', lang: '' });
      expect(StorageService.getSubtitlePref('ch3')).toBeNull();
    });

    it('persists through localStorage (survives a reload)', () => {
      StorageService.setSubtitlePref('ch1', { off: false, name: 'Track 2', lang: 'l1' });
      expect(StorageService.getSubtitlePref('ch1')).toEqual({ off: false, name: 'Track 2', lang: 'l1' });
      expect(localStorage.getItem('iptv_subtitle_prefs')).toContain('Track 2');
    });

    it('ignores an empty channel id', () => {
      StorageService.setSubtitlePref('', { off: true, name: '', lang: '' });
      expect(StorageService.getSubtitlePref('')).toBeNull();
      expect(localStorage.getItem('iptv_subtitle_prefs')).toBeNull();
    });
  });
});

import type { ResumeEntry } from '../types';

const resume = (over: Partial<ResumeEntry>): ResumeEntry => ({
  accountId: 'x1', kind: 'vod', itemId: '10', name: 'Movie One', poster: '', ext: 'mp4',
  position: 100, duration: 6000, updatedAt: 1000, ...over,
});

describe('StorageService resume store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a resume entry keyed by account + kind + item', () => {
    StorageService.setResume(resume({}));
    expect(StorageService.getResume('x1', 'vod', '10')?.position).toBe(100);
    // Different account / kind / item are distinct keys.
    expect(StorageService.getResume('x2', 'vod', '10')).toBeNull();
    expect(StorageService.getResume('x1', 'episode', '10')).toBeNull();
    expect(StorageService.getResume('x1', 'vod', '11')).toBeNull();
  });

  it('clears a finished entry (near the end) instead of storing it', () => {
    StorageService.setResume(resume({ position: 100 }));
    StorageService.setResume(resume({ position: 5990, duration: 6000 })); // within RESUME_FINISH_PAD
    expect(StorageService.getResume('x1', 'vod', '10')).toBeNull();
  });

  it('does not store a position below RESUME_MIN_SECS, and clears an existing one', () => {
    StorageService.setResume(resume({ position: 5 }));
    expect(StorageService.getResume('x1', 'vod', '10')).toBeNull();
    // An existing resume point rewound below the threshold is cleared.
    StorageService.setResume(resume({ position: 100 }));
    StorageService.setResume(resume({ position: 5 }));
    expect(StorageService.getResume('x1', 'vod', '10')).toBeNull();
  });

  it('lists an account\'s entries newest first and clears on demand', () => {
    StorageService.setResume(resume({ itemId: '10', updatedAt: 1000 }));
    StorageService.setResume(resume({ itemId: '11', updatedAt: 2000 }));
    StorageService.setResume(resume({ accountId: 'x2', itemId: '12', updatedAt: 3000 }));
    const list = StorageService.getResumeList('x1');
    expect(list.map((e) => e.itemId)).toEqual(['11', '10']);
    StorageService.clearResume('x1', 'vod', '11');
    expect(StorageService.getResumeList('x1').map((e) => e.itemId)).toEqual(['10']);
  });
});
