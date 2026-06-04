// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { CONFIG } from '../config';
import type { Action, NumberEvent } from '../types';

// KeyHandler attaches its listeners to `document` and keeps module-level singleton
// state. init() must run only once (re-running would stack duplicate listeners),
// so we init in beforeAll and just swap the active handler per test.
let KeyHandler: typeof import('./key-handler').KeyHandler;
let handler: ReturnType<typeof vi.fn>;

const K = CONFIG.KEYS;

function press(keyCode: number, target: EventTarget = document): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true } as KeyboardEventInit),
  );
}

function wheel(deltaY: number, target: EventTarget = document.body): void {
  target.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
}

describe('KeyHandler', () => {
  beforeAll(async () => {
    ({ KeyHandler } = await import('./key-handler'));
    KeyHandler.init();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    handler = vi.fn();
    KeyHandler.setHandler(handler as (a: Action, e?: NumberEvent) => void);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('remote key mapping', () => {
    it.each([
      [K.UP, 'up'],
      [K.DOWN, 'down'],
      [K.LEFT, 'left'],
      [K.RIGHT, 'right'],
      [K.ENTER, 'select'],
      [K.BACK, 'back'],
      [27, 'back'], // Escape on desktop
      [K.RED, 'red'],
      [K.GREEN, 'green'],
      [K.YELLOW, 'yellow'],
      [K.BLUE, 'blue'],
      [K.CH_UP, 'channel_up'],
      [K.CH_DOWN, 'channel_down'],
      [K.PLAY, 'play'],
      [K.PAUSE, 'pause'],
      [K.STOP, 'stop'],
    ])('maps keyCode %i to action "%s"', (keyCode, action) => {
      press(keyCode);
      expect(handler).toHaveBeenCalledWith(action);
    });

    it('ignores unmapped keys', () => {
      press(999);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not handle keys when an input field is focused', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      press(K.DOWN, input);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not handle keys when a textarea is focused', () => {
      const ta = document.createElement('textarea');
      document.body.appendChild(ta);
      press(K.ENTER, ta);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('channel number entry', () => {
    it('buffers consecutive digits and fires a single number action', () => {
      press(K.NUM_0 + 4);
      press(K.NUM_0 + 2);
      expect(handler).not.toHaveBeenCalled(); // waits for the timeout
      vi.advanceTimersByTime(CONFIG.PLAYER.CHANNEL_NUMBER_TIMEOUT);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('number', { number: 42 });
    });

    it('resets the timeout while digits keep coming', () => {
      press(K.NUM_0 + 1);
      vi.advanceTimersByTime(CONFIG.PLAYER.CHANNEL_NUMBER_TIMEOUT - 1);
      press(K.NUM_0 + 7);
      vi.advanceTimersByTime(CONFIG.PLAYER.CHANNEL_NUMBER_TIMEOUT - 1);
      expect(handler).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(handler).toHaveBeenCalledWith('number', { number: 17 });
    });
  });

  describe('Magic Remote pointer (mouse)', () => {
    it('dispatches nav:hover when the pointer moves over a focusable element', () => {
      const el = document.createElement('div');
      el.setAttribute('data-focusable', '');
      document.body.appendChild(el);
      const onHover = vi.fn();
      el.addEventListener('nav:hover', onHover);

      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(onHover).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch nav:hover over non-focusable elements', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const onHover = vi.fn();
      el.addEventListener('nav:hover', onHover);

      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(onHover).not.toHaveBeenCalled();
    });

    it('focuses then selects when a focusable element is clicked', () => {
      const el = document.createElement('div');
      el.setAttribute('data-focusable', '');
      document.body.appendChild(el);
      const onHover = vi.fn();
      el.addEventListener('nav:hover', onHover);

      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onHover).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled(); // select is deferred

      vi.advanceTimersByTime(0);
      expect(handler).toHaveBeenCalledWith('select');
    });

    it('ignores clicks inside the player sidebar/menu (they handle their own)', () => {
      const sidebar = document.createElement('div');
      sidebar.className = 'player-sidebar';
      const el = document.createElement('div');
      el.setAttribute('data-focusable', '');
      sidebar.appendChild(el);
      document.body.appendChild(sidebar);

      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(0);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Magic Remote scroll wheel', () => {
    it('scrolling down changes channel down, up changes channel up', () => {
      wheel(120);
      expect(handler).toHaveBeenLastCalledWith('channel_down');
      wheel(-120);
      expect(handler).toHaveBeenLastCalledWith('channel_up');
    });

    it('swallows the first scroll after a 5s idle period (cursor re-activation)', () => {
      wheel(120); // warmed up by default → acts
      expect(handler).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000); // idle → next scroll only re-activates
      wheel(120);
      expect(handler).toHaveBeenCalledTimes(1); // swallowed

      wheel(120); // now warmed again → acts
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('lets a scrollable ancestor scroll natively instead of changing channel', () => {
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'scroll';
      Object.defineProperty(scroller, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
      const child = document.createElement('div');
      scroller.appendChild(child);
      document.body.appendChild(scroller);

      wheel(120, child);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
