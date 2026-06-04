// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from './storage-service';

describe('StorageService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty playlist list by default', () => {
    expect(StorageService.getPlaylists()).toEqual([]);
  });

  it('round-trips playlists through localStorage', () => {
    const entries = [{ name: 'Test', url: 'http://example.com/p.m3u' }];
    StorageService.setPlaylists(entries);
    expect(StorageService.getPlaylists()).toEqual(entries);
  });

  it('defaults the EPG url to an empty string and round-trips it', () => {
    expect(StorageService.getEpgUrl()).toBe('');
    StorageService.setEpgUrl('http://epg/guide.xml');
    expect(StorageService.getEpgUrl()).toBe('http://epg/guide.xml');
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
});
