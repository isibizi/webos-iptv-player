import { describe, it, expect } from 'vitest';
import {
  normalizeXtreamBaseUrl,
  xtreamPlaylistUrl,
  xtreamEpgUrl,
  xtreamPlayerApi,
  xtreamVodUrl,
  xtreamEpisodeUrl,
} from './xtream-url';

const creds = { baseUrl: 'http://host:8080', username: 'u1', password: 'p1' };

describe('normalizeXtreamBaseUrl', () => {
  it('keeps a full scheme+host+port', () => {
    expect(normalizeXtreamBaseUrl('http://host:8080')).toBe('http://host:8080');
  });

  it('defaults a missing scheme to http', () => {
    expect(normalizeXtreamBaseUrl('host:8080')).toBe('http://host:8080');
  });

  it('preserves an https scheme', () => {
    expect(normalizeXtreamBaseUrl('https://host:8080')).toBe('https://host:8080');
  });

  it('keeps a host with no port', () => {
    expect(normalizeXtreamBaseUrl('http://host')).toBe('http://host');
  });

  it('strips a trailing slash', () => {
    expect(normalizeXtreamBaseUrl('http://host:8080/')).toBe('http://host:8080');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeXtreamBaseUrl('  host:8080  ')).toBe('http://host:8080');
  });
});

describe('xtreamPlaylistUrl', () => {
  it('builds get.php with m3u_plus + ts output', () => {
    expect(xtreamPlaylistUrl(creds)).toBe(
      'http://host:8080/get.php?username=u1&password=p1&type=m3u_plus&output=ts',
    );
  });

  it('normalizes a scheme-less, trailing-slash base', () => {
    expect(xtreamPlaylistUrl({ ...creds, baseUrl: 'host:8080/' })).toBe(
      'http://host:8080/get.php?username=u1&password=p1&type=m3u_plus&output=ts',
    );
  });

  it('handles a base with no port', () => {
    expect(xtreamPlaylistUrl({ ...creds, baseUrl: 'http://host' })).toBe(
      'http://host/get.php?username=u1&password=p1&type=m3u_plus&output=ts',
    );
  });

  it('url-encodes credentials with reserved characters', () => {
    expect(xtreamPlaylistUrl({ ...creds, username: 'u/1', password: 'p&1' })).toBe(
      'http://host:8080/get.php?username=u%2F1&password=p%261&type=m3u_plus&output=ts',
    );
  });
});

describe('xtreamEpgUrl', () => {
  it('builds xmltv.php with credentials', () => {
    expect(xtreamEpgUrl(creds)).toBe('http://host:8080/xmltv.php?username=u1&password=p1');
  });
});

describe('xtreamPlayerApi', () => {
  it('builds the base player_api.php call with no action', () => {
    expect(xtreamPlayerApi(creds)).toBe('http://host:8080/player_api.php?username=u1&password=p1');
  });

  it('appends an action', () => {
    expect(xtreamPlayerApi(creds, 'get_vod_streams')).toBe(
      'http://host:8080/player_api.php?username=u1&password=p1&action=get_vod_streams',
    );
  });

  it('appends extra params after the action', () => {
    expect(xtreamPlayerApi(creds, 'get_vod_streams', { category_id: 5 })).toBe(
      'http://host:8080/player_api.php?username=u1&password=p1&action=get_vod_streams&category_id=5',
    );
  });
});

describe('xtreamVodUrl', () => {
  it('builds /movie/{user}/{pass}/{id}.{ext} on the normalized base', () => {
    expect(xtreamVodUrl(creds, '10', 'mp4')).toBe('http://host:8080/movie/u1/p1/10.mp4');
  });
  it('normalizes a bare host and strips a trailing slash', () => {
    expect(xtreamVodUrl({ baseUrl: 'host:8080/', username: 'u1', password: 'p1' }, '10', 'mkv'))
      .toBe('http://host:8080/movie/u1/p1/10.mkv');
  });
  it('URL-encodes credentials', () => {
    expect(xtreamVodUrl({ baseUrl: 'http://host', username: 'a b', password: 'p/1' }, '5', 'mp4'))
      .toBe('http://host/movie/a%20b/p%2F1/5.mp4');
  });
});

describe('xtreamEpisodeUrl', () => {
  it('builds /series/{user}/{pass}/{id}.{ext} on the normalized base', () => {
    expect(xtreamEpisodeUrl(creds, '42', 'mkv')).toBe('http://host:8080/series/u1/p1/42.mkv');
  });
});
