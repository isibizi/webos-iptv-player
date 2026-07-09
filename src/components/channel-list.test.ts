// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Channel } from '../types';

const { data, playlistMock, epgMock, storageMock } = vi.hoisted(() => {
  const mk = (o: Partial<Channel>): Channel => ({
    id: '', name: '', logo: '', group: '', url: '', extras: null,
    playlistIds: [], catchup: '', catchupSource: '', catchupDays: 0, ...o,
  });
  const channels: Channel[] = [
    mk({ id: 'a', name: 'Alpha', group: 'News', url: 'http://host/a' }),
    mk({ id: 'b', name: 'Bravo', group: 'Sports', url: 'http://host/b' }),
    mk({ id: 'c', name: 'Charlie', group: 'News', url: 'http://host/c' }),
  ];
  const data = { channels, favorites: [] as string[] };

  const getByGroup = (group: string, _playlist?: string): Channel[] => {
    if (!group || group === 'All') return channels;
    if (group === 'Favorites') return channels.filter(c => data.favorites.includes(c.id || c.name));
    return channels.filter(c => c.group === group);
  };

  return {
    data,
    playlistMock: {
      channels,
      playlistTabs: [] as { id: string; name: string }[],
      getGroupsForPlaylist: () => ['News', 'Sports'],
      getByGroup,
      indexOf: (ch: Channel) => channels.indexOf(ch),
      getByIndex: (i: number) => channels[i] ?? null,
    },
    epgMock: { findChannelId: () => null, getNowPlaying: () => null },
    storageMock: {
      getFavorites: () => data.favorites,
      toggleFavorite: vi.fn(),
    },
  };
});

vi.mock('../services/playlist-service', () => ({ PlaylistService: playlistMock }));
vi.mock('../services/epg-service', () => ({ EpgService: epgMock }));
vi.mock('../services/storage-service', () => ({ StorageService: storageMock }));

import { ChannelList } from './channel-list';
import { channelKey } from '../utils/channel';

let container: HTMLElement;
let onSelect: ReturnType<typeof vi.fn>;
let list: ChannelList;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  data.favorites = [];
  playlistMock.playlistTabs = [];
  storageMock.toggleFavorite.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  onSelect = vi.fn();
  list = new ChannelList(container, onSelect);
});

function channelItems(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.channel-main .channel-item'));
}

function hover(el: HTMLElement): void {
  el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
}

describe('ChannelList.render', () => {
  it('initial focus is the first channel when channels exist', () => {
    list.render();
    expect(channelItems()[0].classList.contains('focused')).toBe(true);
  });

  it('renders no title heading or settings gear (the tab bar owns those)', () => {
    list.render();
    expect(container.querySelector('.sidebar-title')).toBeNull();
    expect(container.querySelector('.settings-btn')).toBeNull();
  });

  it('renders the channel count and all channels for the default group', () => {
    list.render();
    expect(container.querySelector('.channel-count')?.textContent).toBe('3 channels');
    expect(channelItems()).toHaveLength(3);
    expect(container.textContent).toContain('Alpha');
  });

  it('renders no inline search magnifier (the tab bar owns search)', () => {
    list.render();
    expect(container.querySelector('.channel-search')).toBeNull();
    expect(container.querySelector('.search-icon')).toBeNull();
  });

  it('renders the group list including All and Favorites', () => {
    list.render();
    const groups = Array.from(container.querySelectorAll<HTMLElement>('.group-item'))
      .map(g => g.dataset.group);
    expect(groups).toEqual(['All', 'Favorites', 'News', 'Sports']);
  });

  it('marks favorites with a star', () => {
    data.favorites = [channelKey(data.channels[0])];
    list.render();
    const alpha = channelItems()[0].querySelector('.channel-name')!;
    expect(alpha.textContent).toContain('★');
  });

  it('shows an empty state when a group has no channels', () => {
    data.favorites = [];
    list.render();
    hover(container.querySelector<HTMLElement>('[data-group="Favorites"]')!);
    list.handleAction('select');
    expect(container.querySelector('.empty-state')?.textContent).toBe('No channels found');
  });

  it('escapes a malicious channel name instead of rendering live HTML (XSS)', () => {
    playlistMock.channels[0].name = '<img src=x onerror="window.__xss=1">';
    try {
      list.render();
      expect(container.querySelector('.channel-main img')).toBeNull();
      expect(container.querySelector('.channel-name')?.textContent)
        .toContain('<img src=x onerror=');
    } finally {
      playlistMock.channels[0].name = 'Alpha';
    }
  });
});

describe('ChannelList interaction', () => {
  beforeEach(() => list.render());

  it('selecting a focused channel plays it', () => {
    hover(channelItems()[1]);
    list.handleAction('select');
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('plays a channel on a Magic Remote pointer mouseup (which fires no click)', () => {
    const target = channelItems()[1];
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => target;
    container.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 50, bubbles: true }));
    document.elementFromPoint = orig;
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('switches group on a pointer mouseup over a group item', () => {
    const group = container.querySelector<HTMLElement>('[data-group="Sports"]')!;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => group;
    container.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: 10, bubbles: true }));
    document.elementFromPoint = orig;
    expect(channelItems()).toHaveLength(1);
    expect(container.textContent).toContain('Bravo');
  });

  it('selecting a group filters the channel list', () => {
    hover(container.querySelector<HTMLElement>('[data-group="Sports"]')!);
    list.handleAction('select');
    expect(channelItems()).toHaveLength(1);
    expect(container.textContent).toContain('Bravo');
    expect(container.textContent).not.toContain('Alpha');
  });

  it('clears the focused channel when the cursor leaves the view', () => {
    hover(channelItems()[1]);
    expect(channelItems()[1].classList.contains('focused')).toBe(true);
    container.dispatchEvent(new MouseEvent('mouseleave'));
    expect(channelItems()[1].classList.contains('focused')).toBe(false);
  });

  it('green toggles the focused channel as a favorite', () => {
    hover(channelItems()[0]);
    list.handleAction('green');
    expect(storageMock.toggleFavorite).toHaveBeenCalledWith(channelKey(data.channels[0]));
  });

  it('a number action plays that channel (1-based)', () => {
    list.handleAction('number', { number: 2 });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('ignores an out-of-range number', () => {
    list.handleAction('number', { number: 99 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('setPlayingIndex marks the playing channel on the next render', () => {
    list.setPlayingIndex(2);
    list.render();
    expect(channelItems()[2].classList.contains('playing')).toBe(true);
  });

  it('highlightEntryPoint focuses the first channel without taking the caret', () => {
    list.highlightEntryPoint();
    expect(channelItems()[0].classList.contains('focused')).toBe(true);
  });
});

describe('ChannelList listener lifecycle', () => {
  it('falls back to the All tab when the selected playlist was removed', () => {
    playlistMock.playlistTabs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    list.render();
    hover(container.querySelector<HTMLElement>('[data-playlist="b"]')!);
    list.handleAction('select');
    expect(container.querySelector('.playlist-tab.active')?.getAttribute('data-playlist')).toBe('b');

    playlistMock.playlistTabs = [{ id: 'a', name: 'A' }, { id: 'c', name: 'C' }]; // 'b' deleted
    list.render();
    expect(container.querySelector('.playlist-tab.active')?.getAttribute('data-playlist')).toBe('');
  });

  it('binds the nav:hover listener once, not per render', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const spy = vi.spyOn(c, 'addEventListener');
    const l = new ChannelList(c, vi.fn());
    l.render();
    l.render();
    l.render();
    const navHover = spy.mock.calls.filter(([type]) => type === 'nav:hover');
    expect(navHover).toHaveLength(1);
  });
});

describe('ChannelList morph lifecycle', () => {
  it('preserves channel-item node identity across re-renders', () => {
    list.render();
    const before = channelItems();
    list.setPlayingIndex(1);
    list.render();
    const after = channelItems();
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it('restores the SpatialNav focus class on the same node after a re-render', () => {
    list.render();
    hover(channelItems()[1]);
    expect(channelItems()[1].classList.contains('focused')).toBe(true);
    list.render();
    // Same DOM node, .focused re-applied via prevFocusedKey lookup.
    expect(channelItems()[1].classList.contains('focused')).toBe(true);
  });
});
