// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Channel } from '../types';

const { data, playlistMock, epgMock, storageMock } = vi.hoisted(() => {
  const mk = (o: Partial<Channel>): Channel => ({
    id: '', name: '', logo: '', group: '', url: '', extras: null,
    playlist: '', catchup: '', catchupSource: '', catchupDays: 0, ...o,
  });
  const channels: Channel[] = [
    mk({ id: 'a', name: 'Alpha', group: 'News' }),
    mk({ id: 'b', name: 'Bravo', group: 'Sports' }),
    mk({ id: 'c', name: 'Charlie', group: 'News' }),
  ];
  const data = { channels, favorites: [] as string[] };

  const getByGroup = (group: string, _playlist?: string): Channel[] => {
    if (!group || group === 'All') return channels;
    if (group === 'Favorites') return channels.filter(c => data.favorites.includes(c.id || c.name));
    return channels.filter(c => c.group === group);
  };

  const search = (q: string, playlist?: string): Channel[] => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const pool = playlist ? channels.filter(c => c.playlist === playlist) : channels;
    return pool.filter(c => c.name.toLowerCase().includes(needle));
  };

  return {
    data,
    playlistMock: {
      channels,
      playlistNames: [] as string[],
      getGroupsForPlaylist: () => ['News', 'Sports'],
      getByGroup,
      search,
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

let container: HTMLElement;
let onSelect: ReturnType<typeof vi.fn>;
let onSettings: ReturnType<typeof vi.fn>;
let list: ChannelList;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  data.favorites = [];
  storageMock.toggleFavorite.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  onSelect = vi.fn();
  onSettings = vi.fn();
  list = new ChannelList(container, onSelect, onSettings);
});

function channelItems(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.channel-main .channel-item'));
}

function hover(el: HTMLElement): void {
  el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
}

describe('ChannelList.render', () => {
  it('initial focus is the search box when channels exist', () => {
    list.render();
    expect(container.querySelector('.channel-search-input.focused')).not.toBeNull();
    expect(channelItems()[0].classList.contains('focused')).toBe(false);
  });

  it('initial focus is the settings gear when there are no channels', () => {
    const saved = playlistMock.channels.splice(0);
    try {
      list.render();
      expect(container.querySelector('.settings-btn.focused')).not.toBeNull();
      expect(container.querySelector('.channel-search-input.focused')).toBeNull();
    } finally {
      playlistMock.channels.push(...saved);
    }
  });

  it('renders the channel count and all channels for the default group', () => {
    list.render();
    expect(container.querySelector('.channel-count')?.textContent).toBe('3 channels');
    expect(channelItems()).toHaveLength(3);
    expect(container.textContent).toContain('Alpha');
  });

  it('renders the group list including All and Favorites', () => {
    list.render();
    const groups = Array.from(container.querySelectorAll<HTMLElement>('.group-item'))
      .map(g => g.dataset.group);
    expect(groups).toEqual(['All', 'Favorites', 'News', 'Sports']);
  });

  it('marks favorites with a star', () => {
    data.favorites = ['a'];
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

  it('clicking the settings gear opens settings', () => {
    container.querySelector<HTMLElement>('.settings-btn')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSettings).toHaveBeenCalled();
  });

  it('selecting a focused channel plays it', () => {
    hover(channelItems()[1]);
    list.handleAction('select');
    expect(onSelect).toHaveBeenCalledWith(1);
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
    expect(storageMock.toggleFavorite).toHaveBeenCalledWith('a');
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
});

describe('ChannelList search', () => {
  beforeEach(() => list.render());

  function searchInput(): HTMLInputElement {
    return container.querySelector<HTMLInputElement>('.channel-search-input')!;
  }

  it('renders a search box at the top of the channel list', () => {
    expect(searchInput()).not.toBeNull();
  });

  it('filters channels by name across all groups as the user types', () => {
    const input = searchInput();
    input.value = 'char';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const names = channelItems().map(i => i.querySelector('.channel-name')?.textContent);
    expect(names).toEqual(['Charlie']);
  });

  it('shows a search-specific empty state when nothing matches', () => {
    const input = searchInput();
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelector('.empty-state')?.textContent)
      .toBe('No channels match your search');
  });

  it('search ignores the selected group (spans all channels)', () => {
    // Narrow to Sports first, then search for a News channel.
    hover(container.querySelector<HTMLElement>('[data-group="Sports"]')!);
    list.handleAction('select');
    const input = searchInput();
    input.value = 'alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(channelItems().map(i => i.querySelector('.channel-name')?.textContent))
      .toEqual(['Alpha']);
  });

  it('clearSearchIfActive clears the query and reports it consumed the action', () => {
    const input = searchInput();
    input.value = 'char';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(channelItems()).toHaveLength(1);

    expect(list.clearSearchIfActive()).toBe(true);
    expect(channelItems()).toHaveLength(3);
    // Nothing to clear the second time.
    expect(list.clearSearchIfActive()).toBe(false);
  });

  it('Escape in the search box clears the query and restores the full list', () => {
    const input = searchInput();
    input.value = 'char';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(channelItems()).toHaveLength(1);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(channelItems()).toHaveLength(3);
  });

  it('highlightEntryPoint highlights the search box without taking the caret', () => {
    list.highlightEntryPoint();
    expect(searchInput().classList.contains('focused')).toBe(true);
    expect(document.activeElement).not.toBe(searchInput());
  });

  it('pressing OK on the highlighted search box gives it the caret at the end', () => {
    const input = searchInput();
    input.value = 'bra';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    list.highlightEntryPoint();  // highlight (nav.focused = input)
    list.handleAction('select'); // OK
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length);
  });
});

describe('ChannelList listener lifecycle', () => {
  it('binds the nav:hover listener once, not per render', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const spy = vi.spyOn(c, 'addEventListener');
    const l = new ChannelList(c, vi.fn(), vi.fn());
    l.render();
    l.render();
    l.render();
    const navHover = spy.mock.calls.filter(([type]) => type === 'nav:hover');
    expect(navHover).toHaveLength(1);
  });

  it('binds the settings-btn click handler once, not per render', () => {
    const onSettings = vi.fn();
    const c = document.createElement('div');
    document.body.appendChild(c);
    const l = new ChannelList(c, vi.fn(), onSettings);
    l.render();
    l.render();
    l.render();
    c.querySelector<HTMLElement>('.settings-btn')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSettings).toHaveBeenCalledTimes(1);
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
