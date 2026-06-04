// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Channel } from '../types';

const { channels } = vi.hoisted(() => {
  function makeChannel(over: Partial<Channel>): Channel {
    return {
      id: '', name: '', logo: '', group: '', url: '', extras: null,
      playlist: '', catchup: '', catchupSource: '', catchupDays: 0, ...over,
    };
  }
  return {
    channels: [
      makeChannel({ id: 'a', name: 'Alpha', playlist: 'PL1' }),
      makeChannel({ id: 'b', name: 'Bravo', playlist: 'PL1' }),
      makeChannel({ id: 'c', name: 'Charlie', playlist: 'PL2' }),
    ] as Channel[],
  };
});

vi.mock('../services/playlist-service', () => ({
  PlaylistService: {
    channels,
    playlistNames: ['PL1', 'PL2'],
    getByIndex: (i: number) => channels[i],
  },
}));

vi.mock('../services/epg-service', () => ({
  EpgService: {
    findChannelId: () => null,
    getNowPlaying: () => null,
  },
}));

import { Sidebar } from './sidebar';

let container: HTMLElement;
let el: HTMLElement;
let getCurrentIndex: ReturnType<typeof vi.fn>;
let onSelect: ReturnType<typeof vi.fn>;
let sidebar: Sidebar;

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no layout
  Element.prototype.scrollIntoView = vi.fn();

  container = document.createElement('div');
  el = document.createElement('div');
  el.id = 'player-sidebar';
  el.className = 'player-sidebar hidden';
  container.appendChild(el);
  document.body.appendChild(container);

  getCurrentIndex = vi.fn(() => 1);
  onSelect = vi.fn();
  sidebar = new Sidebar(container, getCurrentIndex, onSelect);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function items(): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('.sidebar-ch-item'));
}

describe('Sidebar', () => {
  describe('show / hide', () => {
    it('renders all channels and focuses the currently playing one', () => {
      sidebar.show();
      expect(sidebar.visible).toBe(true);
      expect(items()).toHaveLength(3);
      expect(items()[1].classList.contains('focused')).toBe(true); // getCurrentIndex => 1
      expect(el.classList.contains('hidden')).toBe(false);
      expect(el.classList.contains('visible')).toBe(true);
    });

    it('falls back to focus index 0 when the playing channel is not in the list', () => {
      getCurrentIndex.mockReturnValue(-1);
      sidebar.show();
      expect(items()[0].classList.contains('focused')).toBe(true);
    });

    it('hide() removes the visible class and reports not visible', () => {
      sidebar.show();
      sidebar.hide();
      expect(sidebar.visible).toBe(false);
      expect(el.classList.contains('visible')).toBe(false);
    });

    it('show() is idempotent', () => {
      sidebar.show();
      const first = items()[1];
      sidebar.show();
      expect(items()[1]).toBe(first);
    });
  });

  describe('handleAction', () => {
    beforeEach(() => sidebar.show());

    it('down then up moves the focus highlight', () => {
      sidebar.handleAction('down');
      expect(items()[2].classList.contains('focused')).toBe(true);
      sidebar.handleAction('up');
      expect(items()[1].classList.contains('focused')).toBe(true);
    });

    it('channel_up / channel_down behave like up / down', () => {
      sidebar.handleAction('channel_down');
      expect(items()[2].classList.contains('focused')).toBe(true);
      sidebar.handleAction('channel_up');
      expect(items()[1].classList.contains('focused')).toBe(true);
    });

    it('clamps at the ends', () => {
      sidebar.handleAction('up'); // from 1 -> 0
      sidebar.handleAction('up'); // stays 0
      expect(items()[0].classList.contains('focused')).toBe(true);
    });

    it('select fires onSelectChannel with the global index and hides', () => {
      sidebar.handleAction('down'); // focus index 2 (global 2)
      sidebar.handleAction('select');
      expect(onSelect).toHaveBeenCalledWith(2);
      expect(sidebar.visible).toBe(false);
    });
  });

  describe('pointer interaction', () => {
    beforeEach(() => sidebar.show());

    it('clicking a channel item selects it', () => {
      items()[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('clicking a playlist tab filters the list and resets focus', () => {
      const tab = el.querySelector<HTMLElement>('[data-sidebar-playlist="PL2"]')!;
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Only Charlie belongs to PL2, retaining its global index of 2
      expect(items()).toHaveLength(1);
      expect(items()[0].dataset.sidebarIndex).toBe('2');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('hovering an item moves the focus highlight', () => {
      items()[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(items()[2].classList.contains('focused')).toBe(true);
    });

    it('wheel down / up moves the focus highlight', () => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
      expect(items()[2].classList.contains('focused')).toBe(true);
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
      expect(items()[1].classList.contains('focused')).toBe(true);
    });

    it('does not stack listeners across re-renders (single select per click)', () => {
      sidebar.hide();
      sidebar.show(); // re-render #2
      sidebar.hide();
      sidebar.show(); // re-render #3
      items()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('auto-hide timer', () => {
    it('hides itself after the idle timeout', () => {
      sidebar.show();
      vi.advanceTimersByTime(5000);
      expect(sidebar.visible).toBe(false);
    });
  });
});
