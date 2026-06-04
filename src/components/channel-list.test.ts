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

  return {
    data,
    playlistMock: {
      channels,
      playlistNames: [] as string[],
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
