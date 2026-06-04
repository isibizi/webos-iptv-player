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
  return { channels: [makeChannel({ id: 'a', name: 'Alpha' })] as Channel[] };
});

vi.mock('../services/playlist-service', () => ({
  PlaylistService: {
    channels,
    playlistNames: [],
    getByIndex: (i: number) => channels[i],
  },
}));

import { PlayerMenu } from './player-menu';

let container: HTMLElement;
let el: HTMLElement;
let getCurrentIndex: ReturnType<typeof vi.fn>;
let onAction: ReturnType<typeof vi.fn>;
let menu: PlayerMenu;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  el = document.createElement('div');
  el.id = 'player-menu';
  el.className = 'player-menu hidden';
  container.appendChild(el);
  document.body.appendChild(container);

  getCurrentIndex = vi.fn(() => 0);
  onAction = vi.fn();
  menu = new PlayerMenu(container, getCurrentIndex, onAction);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function items(): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('.menu-item'));
}

describe('PlayerMenu', () => {
  it('renders the action items and the playing channel name on show', () => {
    menu.show();
    expect(menu.visible).toBe(true);
    expect(items().map(i => i.dataset.menuAction)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(el.textContent).toContain('Alpha');
    expect(items()[0].classList.contains('focused')).toBe(true);
  });

  it('show() always resets focus to the first item', () => {
    menu.show();
    menu.handleAction('down');
    menu.hide();
    menu.show();
    expect(items()[0].classList.contains('focused')).toBe(true);
  });

  describe('handleAction', () => {
    beforeEach(() => menu.show());

    it('down then up moves the focus highlight', () => {
      menu.handleAction('down');
      expect(items()[1].classList.contains('focused')).toBe(true);
      menu.handleAction('up');
      expect(items()[0].classList.contains('focused')).toBe(true);
    });

    it('clamps at the ends', () => {
      menu.handleAction('up'); // already at 0
      expect(items()[0].classList.contains('focused')).toBe(true);
      for (let i = 0; i < 10; i++) menu.handleAction('down');
      expect(items()[3].classList.contains('focused')).toBe(true);
    });

    it('select emits the focused action and hides the menu', () => {
      menu.handleAction('down'); // focus "green"
      menu.handleAction('select');
      expect(onAction).toHaveBeenCalledWith('green');
      expect(menu.visible).toBe(false);
    });
  });

  describe('pointer interaction', () => {
    beforeEach(() => menu.show());

    it('clicking an item emits its action and hides', () => {
      el.querySelector<HTMLElement>('[data-menu-action="blue"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onAction).toHaveBeenCalledWith('blue');
      expect(menu.visible).toBe(false);
    });

    it('hovering moves the focus highlight', () => {
      el.querySelector<HTMLElement>('[data-menu-action="yellow"]')!
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(items()[2].classList.contains('focused')).toBe(true);
    });

    it('does not stack listeners across re-renders (single emit per click)', () => {
      menu.hide();
      menu.show();
      menu.hide();
      menu.show();
      el.querySelector<HTMLElement>('[data-menu-action="red"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it('hides itself after the idle timeout', () => {
    menu.show();
    vi.advanceTimersByTime(5000);
    expect(menu.visible).toBe(false);
  });
});
