import { CONFIG } from './config';
import { KeyHandler } from './navigation/key-handler';
import { PlaylistService } from './services/playlist-service';
import { EpgService } from './services/epg-service';
import { StorageService } from './services/storage-service';
import { ChannelList } from './components/channel-list';
import { Player } from './components/player';
import { EpgGrid } from './components/epg-grid';
import { Settings } from './components/settings';
import { Sidebar } from './components/sidebar';
import { PlayerMenu } from './components/player-menu';
import { showToast } from './components/toast';
import { $, show, hide } from './utils/dom';
import { createLogger, installGlobalErrorHandlers, logEnvironment } from './utils/logger';
import type { Action, NumberEvent, CatchupInfo } from './types';

const log = createLogger('App');

type ViewName = 'channels' | 'player' | 'epg' | 'settings' | 'loading';

class App {
  private views!: Record<ViewName, HTMLElement>;
  private viewStack: ViewName[] = ['channels'];
  private backPressTime = 0;
  private channelList!: ChannelList;
  private player!: Player;
  private epgGrid!: EpgGrid;
  private settings!: Settings;
  private sidebar!: Sidebar;
  private menu!: PlayerMenu;

  async init(): Promise<void> {
    const done = log.time('init');
    log.info('Initializing app');
    this.views = {
      channels: $('#view-channels')!,
      player: $('#view-player')!,
      epg: $('#view-epg')!,
      settings: $('#view-settings')!,
      loading: $('#view-loading')!,
    };

    this.channelList = new ChannelList(
      this.views.channels,
      (idx) => this.playChannel(idx),
      () => {
        this.settings.render();
        this.showView('settings');
      },
    );
    this.player = new Player(this.views.player, () => {
      this.channelList.setPlayingIndex(this.player.getCurrentIndex());
      this.channelList.render();
      this.showView('channels');
    });
    this.epgGrid = new EpgGrid(this.views.epg, (idx, catchup) => this.playChannel(idx, catchup));
    this.settings = new Settings(this.views.settings, (reload) => this.onSettingsSaved(reload));

    this.player.init($('#video-player') as HTMLVideoElement);
    this.subscribeToForegroundState();

    this.sidebar = new Sidebar(
      this.views.player,
      () => this.player.getCurrentIndex(),
      (idx) => this.playChannel(idx),
    );
    this.menu = new PlayerMenu(
      this.views.player,
      () => this.player.getCurrentIndex(),
      (action) => this.onMenuAction(action),
    );

    KeyHandler.init();
    KeyHandler.setHandler((action, event) => this.handleKey(action, event));

    this.initSidebarTrigger();

    done();
    await this.loadData();
  }

  private async loadData(): Promise<void> {
    const done = log.time('loadData');
    show(this.views.loading);

    try {
      const playlists = StorageService.getPlaylists();
      log.info('Configured playlists:', playlists.length);
      if (!playlists.length) {
        log.info('No playlists configured — opening settings');
        this.showView('settings');
        this.settings.render();
        showToast('Welcome! Add a playlist URL to get started.');
        return;
      }

      const loadingText = $('#loading-text');
      if (loadingText) loadingText.textContent = 'Loading channels...';
      await PlaylistService.load();
      log.info('Channels loaded:', PlaylistService.channels.length,
        '| groups:', PlaylistService.groups.length,
        '| epgUrls:', PlaylistService.epgUrls);

      // Use manually configured EPG URL, or fall back to embedded url-tvg from M3U
      let epgUrl = StorageService.getEpgUrl();
      if (!epgUrl && PlaylistService.epgUrls.length) {
        epgUrl = PlaylistService.epgUrls[0];
        StorageService.setEpgUrl(epgUrl);
        log.info('Using embedded EPG URL from M3U:', epgUrl);
      } else if (epgUrl) {
        log.info('Using configured EPG URL:', epgUrl);
      } else {
        log.warn('No EPG URL configured');
      }

      this.showView('channels');
      this.channelList.render();

      showToast(`${PlaylistService.channels.length} channels loaded`);

      if (StorageService.getAutoPlay()) {
        const lastCh = StorageService.getLastChannel();
        if (lastCh >= 0 && lastCh < PlaylistService.channels.length) {
          log.info('Auto-play resuming last channel index', lastCh);
          this.playChannel(lastCh);
        }
      }

      if (epgUrl) {
        EpgService.load().catch(err => log.error('EPG load failed:', err));
        setInterval(() => EpgService.refresh(), CONFIG.EPG_REFRESH_INTERVAL);
      }
    } catch (err) {
      log.error('loadData failed:', err);
      this.showView('settings');
      this.settings.render();
      showToast('Failed to load playlist. Check your URL.');
    } finally {
      hide(this.views.loading);
      done();
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
      this.sidebar.hide();
      this.menu.hide();
      this.player.stop();
      this.showView('epg');
      this.epgGrid.render();
      // Refresh EPG data in background, then re-render
      EpgService.refresh().then(() => this.epgGrid.render());
      return;
    }
    if (action === 'blue' && currentView !== 'settings') {
      this.sidebar.hide();
      this.menu.hide();
      this.player.stop();
      this.settings.render();
      this.showView('settings');
      return;
    }
    if (action === 'green' && currentView === 'player' && (this.sidebar.visible || this.menu.visible)) {
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
        if (this.sidebar.visible) {
          this.sidebar.hide();
        } else if (this.menu.visible) {
          this.menu.hide();
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
          if (this.menu.visible) this.menu.hide();
          else if (this.sidebar.visible) this.sidebar.hide();
          else this.sidebar.show();
        } else if (action === 'right') {
          if (this.sidebar.visible) this.sidebar.hide();
          else if (this.menu.visible) this.menu.hide();
          else this.menu.show();
        } else if (this.sidebar.visible && (
          action === 'up' || action === 'down' ||
          action === 'channel_up' || action === 'channel_down' ||
          action === 'select'
        )) {
          this.sidebar.handleAction(action);
        } else if (this.menu.visible && (
          action === 'up' || action === 'down' || action === 'select'
        )) {
          this.menu.handleAction(action);
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
      if (e.clientX < 80 && !this.menu.visible) {
        this.sidebar.show();
      } else if (this.sidebar.visible) {
        const overSidebar = !!(e.target as HTMLElement).closest('.player-sidebar');
        if (overSidebar) {
          this.sidebar.resetTimer();
        } else if (e.clientX > 460) {
          this.sidebar.hide();
        }
      }

      // Right menu
      if (e.clientX > 1840 && !this.sidebar.visible) {
        this.menu.show();
      } else if (this.menu.visible) {
        const overMenu = !!(e.target as HTMLElement).closest('.player-menu');
        if (overMenu) {
          this.menu.resetTimer();
        } else if (e.clientX < 1540) {
          this.menu.hide();
        }
      }

      // Bottom OSD info bar
      if (e.clientY > 900 && !this.sidebar.visible && !this.menu.visible) {
        this.player.showOSD();
      }
    });
  }

  private onMenuAction(action: Action): void {
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
    if (!ch) return;
    StorageService.toggleFavorite(ch.id || ch.name);
    showToast(StorageService.getFavorites().includes(ch.id || ch.name)
      ? `Added "${ch.name}" to favorites`
      : `Removed "${ch.name}" from favorites`);
    this.channelList.render();
  }

  private subscribeToForegroundState(): void {
    // Use webOS Luna Service to detect when app goes to background/foreground.
    // This is the only reliable way on webOS — visibilitychange/blur don't fire.
    const webOS = (window as unknown as Record<string, unknown>).webOS as
      { service?: { request(uri: string, params: Record<string, unknown>): void } } | undefined;
    if (!webOS?.service?.request) {
      log.warn('webOS.service.request unavailable — background-suspend Luna subscription skipped');
      return;
    }

    log.info('Subscribing to getForegroundAppInfo');
    webOS.service.request('luna://com.webos.applicationManager', {
      method: 'getForegroundAppInfo',
      parameters: { subscribe: true },
      onSuccess: (res: { appId?: string }) => {
        log.debug('Foreground app:', res.appId);
        if (res.appId && res.appId !== CONFIG.APP_ID) {
          this.player.suspend();
        } else if (res.appId === CONFIG.APP_ID) {
          this.player.resume();
        }
      },
      onFailure: (err: unknown) => {
        log.warn('getForegroundAppInfo failed; falling back to visibility/blur events:', err);
      },
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
  installGlobalErrorHandlers();
  logEnvironment(CONFIG.VERSION);
  const app = new App();
  app.init().catch(err => log.error('App init failed:', err));
});
