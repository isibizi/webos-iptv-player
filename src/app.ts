import { CONFIG } from './config';
import { KeyHandler } from './navigation/key-handler';
import { PlaylistService } from './services/playlist-service';
import { EpgService } from './services/epg-service';
import { StorageService } from './services/storage-service';
import { ChannelList } from './components/channel-list';
import { Player } from './components/player';
import { EpgGrid } from './components/epg-grid';
import { Settings } from './components/settings';
import { showToast } from './components/toast';
import { $, show, hide } from './utils/dom';
import type { Action, NumberEvent, CatchupInfo } from './types';

type ViewName = 'channels' | 'player' | 'epg' | 'settings' | 'loading';

class App {
  private views!: Record<ViewName, HTMLElement>;
  private viewStack: ViewName[] = ['channels'];
  private backPressTime = 0;
  private channelList!: ChannelList;
  private player!: Player;
  private epgGrid!: EpgGrid;
  private settings!: Settings;
  private sidebarVisible = false;
  private sidebarTimer: ReturnType<typeof setTimeout> | null = null;
  private sidebarFocusIdx = -1;
  private sidebarPlaylist = '';  // '' = All
  private menuVisible = false;
  private menuTimer: ReturnType<typeof setTimeout> | null = null;
  private menuFocusIdx = 0;

  async init(): Promise<void> {
    this.views = {
      channels: $('#view-channels')!,
      player: $('#view-player')!,
      epg: $('#view-epg')!,
      settings: $('#view-settings')!,
      loading: $('#view-loading')!,
    };

    this.channelList = new ChannelList(this.views.channels, (idx) => this.playChannel(idx));
    this.player = new Player(this.views.player, () => this.showView('channels'));
    this.epgGrid = new EpgGrid(this.views.epg, (idx, catchup) => this.playChannel(idx, catchup));
    this.settings = new Settings(this.views.settings, (reload) => this.onSettingsSaved(reload));

    this.player.init($('#video-player') as HTMLVideoElement);
    this.subscribeToForegroundState();

    KeyHandler.init();
    KeyHandler.setHandler((action, event) => this.handleKey(action, event));

    this.initSidebarTrigger();

    await this.loadData();
  }

  private async loadData(): Promise<void> {
    show(this.views.loading);

    const playlists = StorageService.getPlaylists();
    if (!playlists.length) {
      hide(this.views.loading);
      this.showView('settings');
      this.settings.render();
      showToast('Welcome! Add a playlist URL to get started.');
      return;
    }

    try {
      const loadingText = $('#loading-text');
      if (loadingText) loadingText.textContent = 'Loading channels...';
      await PlaylistService.load();

      // Use manually configured EPG URL, or fall back to embedded url-tvg from M3U
      let epgUrl = StorageService.getEpgUrl();
      if (!epgUrl && PlaylistService.epgUrls.length) {
        epgUrl = PlaylistService.epgUrls[0];
        StorageService.setEpgUrl(epgUrl);
      }

      hide(this.views.loading);
      this.showView('channels');
      this.channelList.render();

      showToast(`${PlaylistService.channels.length} channels loaded`);

      if (StorageService.getAutoPlay()) {
        const lastCh = StorageService.getLastChannel();
        if (lastCh >= 0 && lastCh < PlaylistService.channels.length) {
          this.playChannel(lastCh);
        }
      }

      if (epgUrl) {
        EpgService.load().catch(err => console.error('Failed to load EPG:', err));
        setInterval(() => EpgService.refresh(), CONFIG.EPG_REFRESH_INTERVAL);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
      hide(this.views.loading);
      this.showView('settings');
      this.settings.render();
      showToast('Failed to load playlist. Check your URL.');
    }
  }

  private showView(name: ViewName): void {
    for (const [key, el] of Object.entries(this.views)) {
      if (key === 'loading') continue;
      if (key === name) show(el);
      else hide(el);
    }

    if (name === 'player') {
      this.viewStack.push(name);
    } else if (name !== this.viewStack[this.viewStack.length - 1]) {
      this.viewStack = [name];
    }
  }

  private playChannel(index: number, catchup?: CatchupInfo): void {
    this.channelList.setPlayingIndex(index);
    this.showView('player');
    this.player.play(index, catchup);
  }

  private handleKey(action: Action, event?: NumberEvent): void {
    const currentView = this.viewStack[this.viewStack.length - 1];

    // Global shortcuts
    if (action === 'red' && currentView !== 'epg') {
      this.hideSidebar();
      this.hideMenu();
      this.player.stop();
      this.showView('epg');
      this.epgGrid.render();
      // Refresh EPG data in background, then re-render
      EpgService.refresh().then(() => this.epgGrid.render());
      return;
    }
    if (action === 'blue' && currentView !== 'settings') {
      this.hideSidebar();
      this.hideMenu();
      this.player.stop();
      this.settings.render();
      this.showView('settings');
      return;
    }
    if (action === 'green' && currentView === 'player' && (this.sidebarVisible || this.menuVisible)) {
      this.togglePlayingFavorite();
      return;
    }
    if (action === 'yellow' && currentView === 'player') {
      this.player.showOSD();
      return;
    }

    // Back handling
    if (action === 'back') {
      if (currentView === 'player') {
        if (this.sidebarVisible) {
          this.hideSidebar();
        } else if (this.menuVisible) {
          this.hideMenu();
        } else {
          this.player.handleAction('back');
        }
        return;
      }
      if (currentView === 'epg' || currentView === 'settings') {
        this.channelList.render();
        this.showView('channels');
        return;
      }
      if (currentView === 'channels') {
        const now = Date.now();
        if (now - this.backPressTime < 3000) {
          const webOS = (window as unknown as Record<string, { platformBack?: () => void }>).webOS;
          if (webOS?.platformBack) webOS.platformBack();
          else window.close();
        } else {
          this.backPressTime = now;
          showToast('Press back again to exit');
        }
        return;
      }
    }

    // Delegate to active view
    switch (currentView) {
      case 'channels':
        this.channelList.handleAction(action, event);
        break;
      case 'player':
        if (action === 'left') {
          if (this.menuVisible) this.hideMenu();
          else if (this.sidebarVisible) this.hideSidebar();
          else this.showSidebar();
        } else if (action === 'right') {
          if (this.sidebarVisible) this.hideSidebar();
          else if (this.menuVisible) this.hideMenu();
          else this.showMenu();
        } else if (this.sidebarVisible && (
          action === 'up' || action === 'down' ||
          action === 'channel_up' || action === 'channel_down' ||
          action === 'select'
        )) {
          this.handleSidebarNav(action);
        } else if (this.menuVisible && (
          action === 'up' || action === 'down' || action === 'select'
        )) {
          this.handleMenuNav(action);
        } else {
          this.player.handleAction(action);
        }
        break;
      case 'epg':
        if (action === 'blue' || action === 'back') {
          this.channelList.render();
          this.showView('channels');
        } else {
          this.epgGrid.handleAction(action, event);
        }
        break;
      case 'settings':
        if (action === 'back') {
          this.channelList.render();
          this.showView('channels');
        } else {
          this.settings.handleAction(action);
        }
        break;
    }
  }

  private initSidebarTrigger(): void {
    document.addEventListener('pointermove', (e: PointerEvent) => {
      const currentView = this.viewStack[this.viewStack.length - 1];
      if (currentView !== 'player') return;

      // Left sidebar (channels)
      if (e.clientX < 80 && !this.menuVisible) {
        this.showSidebar();
      } else if (this.sidebarVisible) {
        const overSidebar = !!(e.target as HTMLElement).closest('.player-sidebar');
        if (overSidebar) {
          this.resetSidebarTimer();
        } else if (e.clientX > 460) {
          this.hideSidebar();
        }
      }

      // Right menu
      if (e.clientX > 1840 && !this.sidebarVisible) {
        this.showMenu();
      } else if (this.menuVisible) {
        const overMenu = !!(e.target as HTMLElement).closest('.player-menu');
        if (overMenu) {
          this.resetMenuTimer();
        } else if (e.clientX < 1540) {
          this.hideMenu();
        }
      }

      // Bottom OSD info bar
      if (e.clientY > 900 && !this.sidebarVisible && !this.menuVisible) {
        this.player.showOSD();
      }
    });
  }

  private showSidebar(): void {
    if (this.sidebarVisible) return;
    if (this.menuVisible) this.hideMenu();
    this.sidebarVisible = true;
    const currentIdx = this.player.getCurrentIndex();
    const entries = this.getSidebarChannels();
    const pos = entries.findIndex(e => e.globalIdx === currentIdx);
    this.sidebarFocusIdx = Math.max(0, pos);
    this.renderSidebar();
    const el = $('#player-sidebar', this.views.player);
    if (el) {
      el.classList.remove('hidden');
      // Trigger reflow so transform transition plays
      el.offsetHeight;
      el.classList.add('visible');
    }
    this.resetSidebarTimer();
  }

  private hideSidebar(): void {
    if (!this.sidebarVisible) return;
    this.sidebarVisible = false;
    const el = $('#player-sidebar', this.views.player);
    if (el) {
      el.classList.remove('visible');
      el.addEventListener('transitionend', () => {
        if (!this.sidebarVisible) el.classList.add('hidden');
      }, { once: true });
    }
    if (this.sidebarTimer) {
      clearTimeout(this.sidebarTimer);
      this.sidebarTimer = null;
    }
  }

  private resetSidebarTimer(): void {
    if (this.sidebarTimer) clearTimeout(this.sidebarTimer);
    this.sidebarTimer = setTimeout(() => {
      // Don't auto-hide if pointer is still over the sidebar
      const el = $('#player-sidebar', this.views.player);
      if (el?.matches(':hover')) {
        this.resetSidebarTimer();
        return;
      }
      this.hideSidebar();
    }, 5000);
  }

  private handleSidebarNav(action: Action): void {
    const el = $('#player-sidebar', this.views.player);
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>('.sidebar-ch-item');
    const len = items.length;
    if (!len) return;

    this.resetSidebarTimer();

    if (action === 'up' || action === 'channel_up') {
      this.sidebarFocusIdx = Math.max(0, this.sidebarFocusIdx - 1);
    } else if (action === 'down' || action === 'channel_down') {
      this.sidebarFocusIdx = Math.min(len - 1, this.sidebarFocusIdx + 1);
    } else if (action === 'select') {
      const item = items[this.sidebarFocusIdx];
      const idx = parseInt(item?.dataset.sidebarIndex || '-1', 10);
      if (idx >= 0) {
        this.playChannel(idx);
        this.hideSidebar();
      }
      return;
    }

    this.updateSidebarFocus(items);
  }

  private updateSidebarFocus(items?: NodeListOf<HTMLElement>): void {
    if (!items) {
      const el = $('#player-sidebar', this.views.player);
      if (!el) return;
      items = el.querySelectorAll<HTMLElement>('.sidebar-ch-item');
    }
    items.forEach((item, i) => {
      item.classList.toggle('focused', i === this.sidebarFocusIdx);
    });
    items[this.sidebarFocusIdx]?.scrollIntoView({ block: 'nearest' });
  }

  private getSidebarChannels(): { ch: import('./types').Channel; globalIdx: number }[] {
    const all = PlaylistService.channels;
    if (!this.sidebarPlaylist) {
      return all.map((ch, i) => ({ ch, globalIdx: i }));
    }
    const result: { ch: import('./types').Channel; globalIdx: number }[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].playlist === this.sidebarPlaylist) {
        result.push({ ch: all[i], globalIdx: i });
      }
    }
    return result;
  }

  private renderSidebar(): void {
    const el = $('#player-sidebar', this.views.player);
    if (!el) return;

    const plNames = PlaylistService.playlistNames;
    const showTabs = plNames.length > 1;
    const entries = this.getSidebarChannels();
    const currentIdx = this.player.getCurrentIndex();

    el.innerHTML = `
      <div class="sidebar-title">Channels</div>
      ${showTabs ? `
        <div class="sidebar-tabs">
          <div class="sidebar-tab ${!this.sidebarPlaylist ? 'active' : ''}"
               data-sidebar-playlist="">All</div>
          ${plNames.map(name => `
            <div class="sidebar-tab ${name === this.sidebarPlaylist ? 'active' : ''}"
                 data-sidebar-playlist="${name}">${name}</div>
          `).join('')}
        </div>
      ` : ''}
      <div class="sidebar-channel-list">
        ${entries.map(({ ch, globalIdx }, i) => {
          const epgId = EpgService.findChannelId(ch);
          const nowPlaying = epgId ? EpgService.getNowPlaying(epgId) : null;
          const isPlaying = globalIdx === currentIdx;
          const isFocused = i === this.sidebarFocusIdx;
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

    // Click to select channel or tab
    el.addEventListener('click', (e: MouseEvent) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-sidebar-playlist]');
      if (tab) {
        this.sidebarPlaylist = tab.dataset.sidebarPlaylist!;
        this.sidebarFocusIdx = 0;
        this.renderSidebar();
        this.resetSidebarTimer();
        return;
      }
      const chItem = (e.target as HTMLElement).closest<HTMLElement>('[data-sidebar-index]');
      if (chItem) {
        const idx = parseInt(chItem.dataset.sidebarIndex!, 10);
        this.playChannel(idx);
        this.hideSidebar();
      }
    });

    // Hover moves focus highlight
    el.addEventListener('mouseover', (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-sidebar-pos]');
      if (item) {
        this.sidebarFocusIdx = parseInt(item.dataset.sidebarPos!, 10);
        this.updateSidebarFocus();
        this.resetSidebarTimer();
      }
    });

    // Scroll wheel moves focus up/down
    el.addEventListener('wheel', (e: WheelEvent) => {
      e.stopPropagation();
      const len = entries.length;
      if (e.deltaY < 0) {
        this.sidebarFocusIdx = Math.max(0, this.sidebarFocusIdx - 1);
      } else if (e.deltaY > 0) {
        this.sidebarFocusIdx = Math.min(len - 1, this.sidebarFocusIdx + 1);
      }
      this.updateSidebarFocus();
      this.resetSidebarTimer();
    }, { passive: false });
  }

  // --- Right menu ---

  private readonly menuItems = [
    { action: 'red' as const, color: 'red', label: 'Programme Guide' },
    { action: 'green' as const, color: 'green', label: 'Toggle Favorite' },
    { action: 'yellow' as const, color: 'yellow', label: 'Channel Info' },
    { action: 'blue' as const, color: 'blue', label: 'Settings' },
  ];

  private showMenu(): void {
    if (this.menuVisible) return;
    if (this.sidebarVisible) this.hideSidebar();
    this.menuVisible = true;
    this.menuFocusIdx = 0;
    this.renderMenu();
    const el = $('#player-menu', this.views.player);
    if (el) {
      el.classList.remove('hidden');
      el.offsetHeight;
      el.classList.add('visible');
    }
    this.resetMenuTimer();
  }

  private hideMenu(): void {
    if (!this.menuVisible) return;
    this.menuVisible = false;
    const el = $('#player-menu', this.views.player);
    if (el) {
      el.classList.remove('visible');
      el.addEventListener('transitionend', () => {
        if (!this.menuVisible) el.classList.add('hidden');
      }, { once: true });
    }
    if (this.menuTimer) {
      clearTimeout(this.menuTimer);
      this.menuTimer = null;
    }
  }

  private resetMenuTimer(): void {
    if (this.menuTimer) clearTimeout(this.menuTimer);
    this.menuTimer = setTimeout(() => {
      const el = $('#player-menu', this.views.player);
      if (el?.matches(':hover')) {
        this.resetMenuTimer();
        return;
      }
      this.hideMenu();
    }, 5000);
  }

  private renderMenu(): void {
    const el = $('#player-menu', this.views.player);
    if (!el) return;

    const ch = PlaylistService.getByIndex(this.player.getCurrentIndex());
    const chName = ch?.name || '';

    el.innerHTML = `
      <div class="menu-header">
        <h2>Menu</h2>
        ${chName ? `<div class="menu-subtitle">Playing: ${chName}</div>` : ''}
      </div>
      <div class="menu-items">
        ${this.menuItems.map((item, i) => `
          <div class="menu-item ${i === this.menuFocusIdx ? 'focused' : ''}"
               data-focusable data-menu-action="${item.action}">
            <span class="menu-dot ${item.color}"></span> ${item.label}
          </div>
        `).join('')}
      </div>
    `;

    // Click handler
    el.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');
      if (btn) this.executeMenuAction(btn.dataset.menuAction as Action);
    });

    // Hover moves focus
    el.addEventListener('mouseover', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');
      if (btn) {
        const items = el.querySelectorAll<HTMLElement>('.menu-item');
        items.forEach((item, i) => {
          if (item === btn) this.menuFocusIdx = i;
          item.classList.toggle('focused', item === btn);
        });
        this.resetMenuTimer();
      }
    });
  }

  private handleMenuNav(action: Action): void {
    const el = $('#player-menu', this.views.player);
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>('.menu-item');
    const len = items.length;
    if (!len) return;

    this.resetMenuTimer();

    if (action === 'up') {
      this.menuFocusIdx = Math.max(0, this.menuFocusIdx - 1);
    } else if (action === 'down') {
      this.menuFocusIdx = Math.min(len - 1, this.menuFocusIdx + 1);
    } else if (action === 'select') {
      const act = items[this.menuFocusIdx]?.dataset.menuAction as Action;
      if (act) this.executeMenuAction(act);
      return;
    }

    items.forEach((item, i) => {
      item.classList.toggle('focused', i === this.menuFocusIdx);
    });
  }

  private executeMenuAction(action: Action): void {
    this.hideMenu();
    if (action === 'green') {
      this.togglePlayingFavorite();
    } else if (action === 'yellow') {
      this.player.showOSD();
    } else {
      this.handleKey(action);
    }
  }

  private togglePlayingFavorite(): void {
    const idx = this.player.getCurrentIndex();
    if (idx < 0) return;
    const ch = PlaylistService.getByIndex(idx);
    if (ch) {
      StorageService.toggleFavorite(ch.id || ch.name);
      showToast(StorageService.getFavorites().includes(ch.id || ch.name)
        ? `Added "${ch.name}" to favorites`
        : `Removed "${ch.name}" from favorites`);
    }
  }

  private subscribeToForegroundState(): void {
    // Use webOS Luna Service to detect when app goes to background/foreground.
    // This is the only reliable way on webOS — visibilitychange/blur don't fire.
    const webOS = (window as unknown as Record<string, unknown>).webOS as
      { service?: { request(uri: string, params: Record<string, unknown>): void } } | undefined;
    if (!webOS?.service?.request) return;

    webOS.service.request('luna://com.webos.applicationManager', {
      method: 'getForegroundAppInfo',
      parameters: { subscribe: true },
      onSuccess: (res: { appId?: string }) => {
        if (res.appId && res.appId !== CONFIG.APP_ID) {
          this.player.suspend();
        } else if (res.appId === CONFIG.APP_ID) {
          this.player.resume();
        }
      },
      onFailure: () => { /* fallback to visibility/blur events in player */ },
    });
  }

  private async onSettingsSaved(reload: boolean): Promise<void> {
    if (reload) {
      StorageService.remove('cached_playlist');
      StorageService.remove('cached_epg');
      this.showView('channels');
      await this.loadData();
    } else {
      this.channelList.render();
      this.showView('channels');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(err => console.error('App init failed:', err));
});
