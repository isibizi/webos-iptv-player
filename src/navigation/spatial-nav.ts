import type { NavDirection } from '../types';

export class SpatialNav {
  private container: HTMLElement;
  focused: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.addEventListener('nav:hover', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.hasAttribute('data-focusable')) {
        this.focus(target);
      }
    });
  }

  private getFocusables(): HTMLElement[] {
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(
        '[data-focusable]:not(.hidden):not([style*="display: none"])'
      )
    );
  }

  focus(el: HTMLElement | null): void {
    // Already focused: re-assert the class (morph may strip it), skip scroll.
    if (el && el === this.focused) {
      el.classList.add('focused');
      return;
    }
    if (this.focused) this.focused.classList.remove('focused');
    this.focused = el;
    if (el) {
      el.classList.add('focused');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  focusFirst(): void {
    const items = this.getFocusables();
    if (items.length) this.focus(items[0]);
  }

  focusBySelector(selector: string): void {
    const el = this.container.querySelector<HTMLElement>(selector);
    if (el) this.focus(el);
  }

  move(direction: NavDirection): void {
    const items = this.getFocusables();
    if (!items.length) return;

    if (!this.focused || !items.includes(this.focused)) {
      this.focus(items[0]);
      return;
    }

    const rect = this.focused.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const item of items) {
      if (item === this.focused) continue;

      const r = item.getBoundingClientRect();
      const ix = r.left + r.width / 2;
      const iy = r.top + r.height / 2;

      const dx = ix - cx;
      const dy = iy - cy;

      let valid = false;
      let primary = 0;
      let secondary = 0;

      switch (direction) {
        case 'up':
          valid = dy < -5;
          primary = Math.abs(dy);
          secondary = Math.abs(dx);
          break;
        case 'down':
          valid = dy > 5;
          primary = Math.abs(dy);
          secondary = Math.abs(dx);
          break;
        case 'left':
          valid = dx < -5;
          primary = Math.abs(dx);
          secondary = Math.abs(dy);
          break;
        case 'right':
          valid = dx > 5;
          primary = Math.abs(dx);
          secondary = Math.abs(dy);
          break;
      }

      if (!valid) continue;

      const sameContainer =
        item.closest('[data-nav-container]') === this.focused.closest('[data-nav-container]');

      const score = primary + secondary * 3 + (sameContainer ? 0 : 5000);

      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }

    if (best) this.focus(best);
  }
}
