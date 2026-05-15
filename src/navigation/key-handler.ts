import { CONFIG } from '../config';
import type { Action, NumberEvent } from '../types';

type ActionHandler = (action: Action, event?: NumberEvent) => void;

const K = CONFIG.KEYS;

const ACTION_MAP: Record<number, Action> = {
  [K.UP]: 'up',
  [K.DOWN]: 'down',
  [K.LEFT]: 'left',
  [K.RIGHT]: 'right',
  [K.ENTER]: 'select',
  [K.BACK]: 'back',
  27: 'back', // Escape key for desktop
  [K.RED]: 'red',
  [K.GREEN]: 'green',
  [K.YELLOW]: 'yellow',
  [K.BLUE]: 'blue',
  [K.CH_UP]: 'channel_up',
  [K.CH_DOWN]: 'channel_down',
  [K.PLAY]: 'play',
  [K.PAUSE]: 'pause',
  [K.STOP]: 'stop',
};

let activeHandler: ActionHandler | null = null;
let numberBuffer = '';
let numberTimer: ReturnType<typeof setTimeout> | null = null;
let wheelWarmedUp = true;
let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

function handleNumber(digit: number): void {
  numberBuffer += digit;
  if (numberTimer) clearTimeout(numberTimer);
  numberTimer = setTimeout(() => {
    const num = parseInt(numberBuffer, 10);
    numberBuffer = '';
    if (activeHandler) activeHandler('number', { number: num });
  }, CONFIG.PLAYER.CHANNEL_NUMBER_TIMEOUT);
}

export const KeyHandler = {
  init(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // Let input fields handle their own keyboard events
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const keyCode = e.keyCode;

      if (keyCode >= K.NUM_0 && keyCode <= K.NUM_9) {
        e.preventDefault();
        handleNumber(keyCode - K.NUM_0);
        return;
      }

      const action = ACTION_MAP[keyCode];
      if (action) {
        e.preventDefault();
        if (activeHandler) activeHandler(action);
      }
    });

    // Mouse support for desktop preview
    document.addEventListener('mouseover', (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-focusable]');
      if (target) {
        target.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
      }
    });

    // Magic Remote scroll wheel / desktop mouse wheel
    // Let scrollable containers (like the player sidebar) scroll natively
    // First scroll after pointer was hidden just reactivates the cursor
    document.addEventListener('wheel', (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.player-sidebar, .epg-channels-pane, .epg-programmes-pane')) return;
      e.preventDefault();

      // Reset idle timer — if no scroll for 5s, next scroll is swallowed
      if (wheelIdleTimer) clearTimeout(wheelIdleTimer);
      wheelIdleTimer = setTimeout(() => { wheelWarmedUp = false; }, 5000);

      if (!wheelWarmedUp) {
        wheelWarmedUp = true;
        return;
      }

      if (!activeHandler) return;
      if (e.deltaY < 0) activeHandler('channel_up');
      else if (e.deltaY > 0) activeHandler('channel_down');
    }, { passive: false });

    document.addEventListener('click', (e: MouseEvent) => {
      // Player sidebar/menu handle their own clicks
      if ((e.target as HTMLElement).closest('.player-sidebar, .player-menu')) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-focusable]');
      if (target && activeHandler) {
        target.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
        // Small delay to let focus settle before firing select
        setTimeout(() => activeHandler!('select'), 0);
      }
    });
  },

  setHandler(handler: ActionHandler): void {
    activeHandler = handler;
  },
};
