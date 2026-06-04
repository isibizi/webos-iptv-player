import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Channel } from '../types';

const { storageMock, fetchTextMock } = vi.hoisted(() => ({
  storageMock: {
    getCachedPlaylist: vi.fn(),
    getPlaylists: vi.fn(),
    setCachedPlaylist: vi.fn(),
    getFavorites: vi.fn(() => [] as string[]),
  },
  fetchTextMock: vi.fn(),
}));

vi.mock('./storage-service', () => ({ StorageService: storageMock }));
vi.mock('../utils/fetch-helper', () => ({ fetchText: fetchTextMock }));

import { PlaylistService } from './playlist-service';

function channel(over: Partial<Channel>): Channel {
  return {
    id: '', name: '', logo: '', group: '', url: '', extras: null,
    playlist: '', catchup: '', catchupSource: '', catchupDays: 0, ...over,
  };
}

const P1 = `#EXTM3U url-tvg="http://localhost:8080/epg.xml"
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://stream/u1
#EXTINF:-1 tvg-id="b",Bravo
http://stream/u2`;

const P2 = `#EXTM3U
#EXTINF:-1 tvg-id="b",Bravo Dup
http://stream/u2
#EXTINF:-1 tvg-id="c" group-title="Sports",Charlie
http://stream/u3`;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getFavorites.mockReturnValue([]);
  PlaylistService.channels = [];
  PlaylistService.groups = [];
  PlaylistService.playlistNames = [];
  PlaylistService.epgUrls = [];
});

describe('PlaylistService.refresh', () => {
  beforeEach(() => {
    storageMock.getPlaylists.mockReturnValue([
      { name: 'P1', url: 'http://host1/p1.m3u' },
      { name: 'P2', url: 'http://host2/p2.m3u' },
    ]);
    fetchTextMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('p1') ? P1 : P2),
    );
  });

  it('merges playlists and de-duplicates channels by URL', async () => {
    const channels = await PlaylistService.refresh();
    expect(channels.map(c => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('tags each channel with its source playlist name', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.channels.map(c => c.playlist)).toEqual(['P1', 'P1', 'P2']);
  });

  it('rewrites a loopback EPG host to the playlist host', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.epgUrls).toEqual(['http://host1:8080/epg.xml']);
  });

  it('builds the group and playlist-name sets', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.groups).toEqual(['News', 'Uncategorized', 'Sports']);
    expect(PlaylistService.playlistNames).toEqual(['P1', 'P2']);
  });

  it('persists the merged result to the cache', async () => {
    await PlaylistService.refresh();
    expect(storageMock.setCachedPlaylist).toHaveBeenCalledWith(
      PlaylistService.channels,
      ['http://host1:8080/epg.xml'],
    );
  });

  it('returns an empty list and skips fetching when no playlists are configured', async () => {
    storageMock.getPlaylists.mockReturnValue([]);
    const channels = await PlaylistService.refresh();
    expect(channels).toEqual([]);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('skips a playlist that fails to fetch but keeps the others', async () => {
    fetchTextMock.mockImplementation((url: string) =>
      url.includes('p1') ? Promise.reject(new Error('boom')) : Promise.resolve(P2),
    );
    const channels = await PlaylistService.refresh();
    expect(channels.map(c => c.name)).toEqual(['Bravo Dup', 'Charlie']);
  });
});

describe('PlaylistService.load', () => {
  it('uses the cached playlist without hitting the network', async () => {
    const cached = [channel({ id: 'a', name: 'Alpha', group: 'News', playlist: 'P1' })];
    storageMock.getCachedPlaylist.mockReturnValue({ channels: cached, epgUrls: ['http://e'] });
    const result = await PlaylistService.load();
    expect(result).toBe(cached);
    expect(PlaylistService.groups).toEqual(['News']);
    expect(PlaylistService.epgUrls).toEqual(['http://e']);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('refreshes from the network on a cache miss', async () => {
    storageMock.getCachedPlaylist.mockReturnValue(null);
    storageMock.getPlaylists.mockReturnValue([{ name: 'P2', url: 'http://host2/p2.m3u' }]);
    fetchTextMock.mockResolvedValue(P2);
    const result = await PlaylistService.load();
    expect(result.map(c => c.name)).toEqual(['Bravo Dup', 'Charlie']);
    expect(fetchTextMock).toHaveBeenCalled();
  });
});

describe('PlaylistService.getByGroup', () => {
  beforeEach(() => {
    PlaylistService.channels = [
      channel({ id: 'a', name: 'Alpha', group: 'News', playlist: 'P1' }),
      channel({ id: 'b', name: 'Bravo', group: 'Sports', playlist: 'P1' }),
      channel({ id: 'c', name: 'Charlie', group: 'News', playlist: 'P2' }),
    ];
  });

  it('returns everything for "All"', () => {
    expect(PlaylistService.getByGroup('All').map(c => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('filters by group', () => {
    expect(PlaylistService.getByGroup('News').map(c => c.name)).toEqual(['Alpha', 'Charlie']);
  });

  it('filters by playlist when provided', () => {
    expect(PlaylistService.getByGroup('All', 'P1').map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(PlaylistService.getByGroup('News', 'P2').map(c => c.name)).toEqual(['Charlie']);
  });

  it('resolves "Favorites" against StorageService, keyed by id or name', () => {
    storageMock.getFavorites.mockReturnValue(['b']);
    expect(PlaylistService.getByGroup('Favorites').map(c => c.name)).toEqual(['Bravo']);
  });
});

describe('PlaylistService.getGroupsForPlaylist', () => {
  beforeEach(() => {
    PlaylistService.channels = [
      channel({ name: 'Alpha', group: 'News', playlist: 'P1' }),
      channel({ name: 'Bravo', group: 'Sports', playlist: 'P1' }),
      channel({ name: 'Charlie', group: 'Movies', playlist: 'P2' }),
    ];
  });

  it('returns the distinct groups within a playlist', () => {
    expect(PlaylistService.getGroupsForPlaylist('P1')).toEqual(['News', 'Sports']);
  });

  it('returns all groups when no playlist is given', () => {
    expect(PlaylistService.getGroupsForPlaylist()).toEqual(['News', 'Sports', 'Movies']);
  });
});
