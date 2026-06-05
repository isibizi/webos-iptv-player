import type { Action } from '../types';
import { PlaylistService } from '../services/playlist-service';
import { $, html } from '../utils/dom';
import { morph } from '../utils/morph';

const AUTO_HIDE_MS = 5000;

const MENU_ITEMS = [
  { action: 'red' as const, color: 'red', label: 'Programme Guide' },
  { action: 'green' as const, color: 'green', label: 'Toggle Favorite' },
  { action: 'yellow' as const, color: 'yellow', label: 'Channel Info' },
  { action: 'blue' as const, color: 'blue', label: 'Settings' },
];

/**
 * The action overlay shown on the right edge during playback. Owns its own
 * visibility, auto-hide timer and focus index. Selecting an item hides the
 * menu and emits the chosen action via `onAction`; the host decides how to
 * route it. Delegated DOM listeners are bound once in the constructor.
 */
export class PlayerMenu {
  private el: HTMLElement | null;
  private getCurrentIndex: () => number;
  private onAction: (action: Action) => void;
  private isVisible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private focusIdx = 0;

  constructor(
    container: HTMLElement,
    getCurrentIndex: () => number,
    onAction: (action: Action) => void,
  ) {
    this.getCurrentIndex = getCurrentIndex;
    this.onAction = onAction;
    this.el = $('#player-menu', container);
    this.bindEvents();
  }

  get visible(): boolean {
    return this.isVisible;
  }

  show(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    this.focusIdx = 0;
    this.render();
    if (this.el) {
      this.el.classList.remove('hidden');
      this.el.offsetHeight;
      this.el.classList.add('visible');
    }
    this.resetTimer();
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    const el = this.el;
    if (el) {
      el.classList.remove('visible');
      el.addEventListener('transitionend', () => {
        if (!this.isVisible) el.classList.add('hidden');
      }, { once: true });
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.el?.matches(':hover')) {
        this.resetTimer();
        return;
      }
      this.hide();
    }, AUTO_HIDE_MS);
  }

  handleAction(action: Action): void {
    if (!this.el) return;
    const items = this.el.querySelectorAll<HTMLElement>('.menu-item');
    const len = items.length;
    if (!len) return;

    this.resetTimer();

    if (action === 'up') {
      this.focusIdx = Math.max(0, this.focusIdx - 1);
    } else if (action === 'down') {
      this.focusIdx = Math.min(len - 1, this.focusIdx + 1);
    } else if (action === 'select') {
      const act = items[this.focusIdx]?.dataset.menuAction as Action;
      if (act) this.activate(act);
      return;
    }

    items.forEach((item, i) => {
      item.classList.toggle('focused', i === this.focusIdx);
    });
  }

  private activate(action: Action): void {
    this.hide();
    this.onAction(action);
  }

  private render(): void {
    const el = this.el;
    if (!el) return;

    const ch = PlaylistService.getByIndex(this.getCurrentIndex());
    const chName = ch?.name || '';

    morph(el, html`
      <div class="menu-header">
        <h2>Menu</h2>
        ${chName ? html`<div class="menu-subtitle">Playing: ${chName}</div>` : ''}
      </div>
      <div class="menu-items">
        ${MENU_ITEMS.map((item, i) => html`
          <div class="menu-item ${i === this.focusIdx ? 'focused' : ''}"
               data-key="${item.action}"
               data-focusable data-menu-action="${item.action}">
            <span class="menu-dot ${item.color}"></span> ${item.label}
          </div>
        `)}
      </div>
    `);
  }

  private bindEvents(): void {
    const el = this.el;
    if (!el) return;

    // Click selects an item
    el.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');
      if (btn) this.activate(btn.dataset.menuAction as Action);
    });

    // Hover moves focus
    el.addEventListener('mouseover', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');
      if (btn) {
        const items = el.querySelectorAll<HTMLElement>('.menu-item');
        items.forEach((item, i) => {
          if (item === btn) this.focusIdx = i;
          item.classList.toggle('focused', item === btn);
        });
        this.resetTimer();
      }
    });
  }
}
