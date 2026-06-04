import type { Action, Channel } from '../types';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { $ } from '../utils/dom';

type SidebarEntry = { ch: Channel; globalIdx: number };

const AUTO_HIDE_MS = 5000;

/**
 * The channel overlay shown on the left edge during playback. Owns its own
 * visibility, auto-hide timer, focus index and playlist tab. Delegated DOM
 * listeners are bound once in the constructor so they do not accumulate across
 * re-renders.
 */
export class Sidebar {
  private el: HTMLElement | null;
  private getCurrentIndex: () => number;
  private onSelectChannel: (index: number) => void;
  private isVisible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private focusIdx = -1;
  private playlist = ''; // '' = All

  constructor(
    container: HTMLElement,
    getCurrentIndex: () => number,
    onSelectChannel: (index: number) => void,
  ) {
    this.getCurrentIndex = getCurrentIndex;
    this.onSelectChannel = onSelectChannel;
    this.el = $('#player-sidebar', container);
    this.bindEvents();
  }

  get visible(): boolean {
    return this.isVisible;
  }

  show(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    const currentIdx = this.getCurrentIndex();
    const entries = this.getChannels();
    const pos = entries.findIndex(e => e.globalIdx === currentIdx);
    this.focusIdx = Math.max(0, pos);
    this.render();
    if (this.el) {
      this.el.classList.remove('hidden');
      // Trigger reflow so transform transition plays
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
      // Don't auto-hide if pointer is still over the sidebar
      if (this.el?.matches(':hover')) {
        this.resetTimer();
        return;
      }
      this.hide();
    }, AUTO_HIDE_MS);
  }

  handleAction(action: Action): void {
    if (!this.el) return;
    const items = this.el.querySelectorAll<HTMLElement>('.sidebar-ch-item');
    const len = items.length;
    if (!len) return;

    this.resetTimer();

    if (action === 'up' || action === 'channel_up') {
      this.focusIdx = Math.max(0, this.focusIdx - 1);
    } else if (action === 'down' || action === 'channel_down') {
      this.focusIdx = Math.min(len - 1, this.focusIdx + 1);
    } else if (action === 'select') {
      const item = items[this.focusIdx];
      const idx = parseInt(item?.dataset.sidebarIndex || '-1', 10);
      if (idx >= 0) {
        this.onSelectChannel(idx);
        this.hide();
      }
      return;
    }

    this.updateFocus(items);
  }

  private getChannels(): SidebarEntry[] {
    const all = PlaylistService.channels;
    if (!this.playlist) {
      return all.map((ch, i) => ({ ch, globalIdx: i }));
    }
    const result: SidebarEntry[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].playlist === this.playlist) {
        result.push({ ch: all[i], globalIdx: i });
      }
    }
    return result;
  }

  private updateFocus(items?: NodeListOf<HTMLElement>): void {
    if (!items) {
      if (!this.el) return;
      items = this.el.querySelectorAll<HTMLElement>('.sidebar-ch-item');
    }
    items.forEach((item, i) => {
      item.classList.toggle('focused', i === this.focusIdx);
    });
    items[this.focusIdx]?.scrollIntoView({ block: 'nearest' });
  }

  private render(): void {
    const el = this.el;
    if (!el) return;

    const plNames = PlaylistService.playlistNames;
    const showTabs = plNames.length > 1;
    const entries = this.getChannels();
    const currentIdx = this.getCurrentIndex();

    el.innerHTML = `
      <div class="sidebar-title">Channels</div>
      ${showTabs ? `
        <div class="sidebar-tabs">
          <div class="sidebar-tab ${!this.playlist ? 'active' : ''}"
               data-sidebar-playlist="">All</div>
          ${plNames.map(name => `
            <div class="sidebar-tab ${name === this.playlist ? 'active' : ''}"
                 data-sidebar-playlist="${name}">${name}</div>
          `).join('')}
        </div>
      ` : ''}
      <div class="sidebar-channel-list">
        ${entries.map(({ ch, globalIdx }, i) => {
          const epgId = EpgService.findChannelId(ch);
          const nowPlaying = epgId ? EpgService.getNowPlaying(epgId) : null;
          const isPlaying = globalIdx === currentIdx;
          const isFocused = i === this.focusIdx;
          return `
            <div class="sidebar-ch-item ${isPlaying ? 'playing' : ''} ${isFocused ? 'focused' : ''}"
                 data-focusable data-sidebar-index="${globalIdx}" data-sidebar-pos="${i}">
              <span class="ch-num">${globalIdx + 1}</span>
              ${ch.logo
                ? `<img class="ch-logo" src="${ch.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="ch-logo-placeholder">${ch.name.charAt(0)}</div>`}
              <div class="ch-info">
                <span class="ch-name">${ch.name}</span>
                ${nowPlaying ? `<span class="ch-now"><span class="ch-now-text">${nowPlaying.title}</span></span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Scroll to the focused channel
    const focusedEl = el.querySelector('.sidebar-ch-item.focused');
    if (focusedEl) focusedEl.scrollIntoView({ block: 'center' });

    // Enable marquee scroll only for overflowing programme names
    requestAnimationFrame(() => {
      el.querySelectorAll<HTMLElement>('.ch-now').forEach(container => {
        const span = container.querySelector<HTMLElement>('.ch-now-text');
        if (!span) return;
        const textWidth = span.offsetWidth;
        const containerWidth = container.offsetWidth;
        if (textWidth > containerWidth) {
          const dist = containerWidth - textWidth;
          span.style.setProperty('--scroll-dist', `${dist}px`);
          span.classList.add('scrolling');
        }
      });
    });
  }

  private bindEvents(): void {
    const el = this.el;
    if (!el) return;

    // Click to select channel or tab
    el.addEventListener('click', (e: MouseEvent) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-sidebar-playlist]');
      if (tab) {
        this.playlist = tab.dataset.sidebarPlaylist!;
        this.focusIdx = 0;
        this.render();
        this.resetTimer();
        return;
      }
      const chItem = (e.target as HTMLElement).closest<HTMLElement>('[data-sidebar-index]');
      if (chItem) {
        const idx = parseInt(chItem.dataset.sidebarIndex!, 10);
        this.onSelectChannel(idx);
        this.hide();
      }
    });

    // Hover moves focus highlight
    el.addEventListener('mouseover', (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-sidebar-pos]');
      if (item) {
        this.focusIdx = parseInt(item.dataset.sidebarPos!, 10);
        this.updateFocus();
        this.resetTimer();
      }
    });

    // Scroll wheel moves focus up/down
    el.addEventListener('wheel', (e: WheelEvent) => {
      e.stopPropagation();
      const len = this.getChannels().length;
      if (e.deltaY < 0) {
        this.focusIdx = Math.max(0, this.focusIdx - 1);
      } else if (e.deltaY > 0) {
        this.focusIdx = Math.min(len - 1, this.focusIdx + 1);
      }
      this.updateFocus();
      this.resetTimer();
    }, { passive: false });
  }
}
