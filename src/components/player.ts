import type { Action, Channel, CatchupInfo } from '../types';
import { $, show, hide } from '../utils/dom';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { StorageService } from '../services/storage-service';
import { CONFIG } from '../config';
import { formatTime, formatDuration, getProgress } from '../utils/time';

// hls.js and mpegts.js are loaded as globals via preview-libs.js (desktop only)
const win = window as unknown as Record<string, unknown>;
type HlsType = typeof import('hls.js').default;
type MpegtsType = typeof import('mpegts.js').default;

export class Player {
  private container: HTMLElement;
  private onBack: () => void;
  private videoEl: HTMLVideoElement | null = null;
  private hls: InstanceType<HlsType> | null = null;
  private mpegtsPlayer: { destroy(): void } | null = null;
  private currentChannel: Channel | null = null;
  private currentIndex = -1;
  private catchupInfo: CatchupInfo | null = null;
  private osdVisible = false;
  private osdTimer: ReturnType<typeof setTimeout> | null = null;
  private wasPlayingBeforeHide = false;
  constructor(container: HTMLElement, onBack: () => void) {
    this.container = container;
    this.onBack = onBack;
  }

  init(videoEl: HTMLVideoElement): void {
    this.videoEl = videoEl;
    this.videoEl.addEventListener('error', () => this.onError());

    // Suspend/resume playback when the app goes to background.
    // webOS needs multiple event sources — blur/focus is what actually
    // fires on Home press, but we also listen for visibility events.
    const onHidden = () => this.suspend();
    const onVisible = () => this.resume();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) onHidden(); else onVisible();
    });
    document.addEventListener('webkitvisibilitychange', () => {
      if ((document as unknown as Record<string, boolean>).webkitHidden) onHidden();
      else onVisible();
    });
    window.addEventListener('blur', onHidden);
    window.addEventListener('focus', onVisible);
  }

  suspend(): void {
    if (!this.videoEl || !this.currentChannel) return;
    if (this.wasPlayingBeforeHide) return; // already suspended
    this.wasPlayingBeforeHide = !this.videoEl.paused;
    if (this.wasPlayingBeforeHide) {
      if (this.hls) {
        this.hls.destroy();
        this.hls = null;
      }
      if (this.mpegtsPlayer) {
        this.mpegtsPlayer.destroy();
        this.mpegtsPlayer = null;
      }
      // On webOS, the native media pipeline runs in a separate process.
      // Removing src/innerHTML isn't enough — we must destroy the video
      // element entirely and create a fresh one to kill the pipeline.
      const old = this.videoEl;
      old.pause();
      old.removeAttribute('src');
      old.innerHTML = '';
      old.load();
      const fresh = document.createElement('video');
      fresh.id = old.id;
      fresh.autoplay = true;
      fresh.addEventListener('error', () => this.onError());
      old.parentNode!.replaceChild(fresh, old);
      this.videoEl = fresh;
    }
  }

  resume(): void {
    if (!this.videoEl || !this.currentChannel) return;
    if (this.wasPlayingBeforeHide) {
      this.wasPlayingBeforeHide = false;
      this.play(this.currentIndex, this.catchupInfo || undefined);
    }
  }

  play(channelIndex: number, catchup?: CatchupInfo): void {
    const channel = PlaylistService.getByIndex(channelIndex);
    if (!channel || !this.videoEl) return;

    this.currentChannel = channel;
    this.currentIndex = channelIndex;
    this.catchupInfo = catchup || null;
    StorageService.setLastChannel(channelIndex);

    // For catch-up/timeshift, use the catchup-source URL template
    let url = channel.url;
    if (catchup && channel.catchupSource) {
      url = channel.catchupSource
        .replace('{channel-id}', encodeURIComponent(channel.id || channel.name))
        .replace('{utc}', String(catchup.start))
        .replace('{utcend}', String(catchup.end));
    }

    this.videoEl.classList.add('active');
    this.loadStream(url, channel.extras);
    this.showOSD();
    show(this.container);
  }

  stop(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.mpegtsPlayer) {
      this.mpegtsPlayer.destroy();
      this.mpegtsPlayer = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.innerHTML = '';
      this.videoEl.load();
      this.videoEl.classList.remove('active');
    }
    this.hideOSD();
    hide(this.container);
  }

  private loadStream(url: string, extras: Record<string, string> | null): void {
    if (!this.videoEl) return;

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.mpegtsPlayer) {
      this.mpegtsPlayer.destroy();
      this.mpegtsPlayer = null;
    }

    const isHls = url.includes('.m3u8');
    const isTs = url.endsWith('.ts') || url.includes('.ts?');
    const isFlv = url.endsWith('.flv') || url.includes('.flv?');
    const isWebOS = /webOS|Web0S/i.test(navigator.userAgent);

    // On webOS, prefer native playback — the TV has hardware HLS/TS decoders
    // that work better than MSE-based libraries
    if (isWebOS || this.videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Use a <source> element with explicit MIME type so the browser
      // knows the format even when the URL has no file extension
      this.videoEl.removeAttribute('src');
      this.videoEl.innerHTML = '';
      const source = document.createElement('source');
      source.src = url;
      source.type = isFlv ? 'video/x-flv'
        : isTs ? 'video/mp2t'
        : 'application/vnd.apple.mpegurl';
      this.videoEl.appendChild(source);
      this.videoEl.load();
      this.videoEl.play().catch(() => {});
    } else if (isHls) {
      this.loadWithHls(url, extras);
    } else if (isTs || isFlv) {
      this.loadWithMpegts(url, isFlv);
    } else {
      this.videoEl.src = url;
      this.videoEl.play().catch(() => {});
    }
  }

  private loadWithHls(url: string, extras: Record<string, string> | null): void {
    if (!this.videoEl) return;
    const Hls = win.__Hls as HlsType | undefined;
    try {
      if (!Hls?.isSupported()) {
        this.videoEl.src = url;
        this.videoEl.play().catch(() => {});
        return;
      }

      const hlsConfig: Record<string, unknown> = {
        maxBufferLength: CONFIG.PLAYER.BUFFER_LENGTH,
        enableWorker: false,
      };

      if (extras?.['http-user-agent']) {
        hlsConfig.xhrSetup = (xhr: XMLHttpRequest) => {
          xhr.setRequestHeader('User-Agent', extras['http-user-agent']);
        };
      }

      this.hls = new Hls(hlsConfig);
      this.hls.loadSource(url);
      this.hls.attachMedia(this.videoEl);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.videoEl?.play().catch(() => {});
      });
      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            this.hls?.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            this.hls?.recoverMediaError();
          } else {
            this.onError();
          }
        }
      });
    } catch {
      this.videoEl.src = url;
      this.videoEl.play().catch(() => {});
    }
  }

  private loadWithMpegts(url: string, isFlv: boolean): void {
    if (!this.videoEl) return;
    const mpegts = win.__mpegts as MpegtsType | undefined;
    try {
      if (!mpegts?.isSupported()) {
        this.videoEl.src = url;
        this.videoEl.play().catch(() => {});
        return;
      }

      const player = mpegts.createPlayer({
        type: isFlv ? 'flv' : 'mpegts',
        isLive: true,
        url,
      });
      this.mpegtsPlayer = player;
      player.attachMediaElement(this.videoEl);
      player.load();
      player.play();
      player.on(mpegts.Events.ERROR, () => {
        this.onError();
      });
    } catch {
      this.videoEl.src = url;
      this.videoEl.play().catch(() => {});
    }
  }

  private onError(): void {
    this.updateOSDMessage('Stream error - trying next channel...');
    setTimeout(() => this.channelUp(), 2000);
  }

  showOSD(): void {
    this.osdVisible = true;
    this.renderOSD();
    show($('#player-osd', this.container));
    if (this.osdTimer) clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.hideOSD(), CONFIG.PLAYER.OSD_TIMEOUT);
  }

  hideOSD(): void {
    this.osdVisible = false;
    hide($('#player-osd', this.container));
    if (this.osdTimer) clearTimeout(this.osdTimer);
  }

  private toggleOSD(): void {
    if (this.osdVisible) this.hideOSD();
    else this.showOSD();
  }

  private renderOSD(): void {
    const osd = $('#player-osd', this.container);
    if (!osd || !this.currentChannel) return;

    const ch = this.currentChannel;
    const catchup = this.catchupInfo;

    let programmeHtml = '';
    if (catchup) {
      // Catch-up playback: show the selected programme's info
      const start = new Date(catchup.start * 1000);
      const end = new Date(catchup.end * 1000);
      const progress = getProgress(start, end);
      const duration = formatDuration(end.getTime() - start.getTime());
      programmeHtml = `
        <div class="osd-programme">
          <div class="osd-now-label">CATCH-UP</div>
          <div class="osd-programme-detail">
            ${catchup.icon ? `<img class="osd-programme-icon" src="${catchup.icon}" alt="" onerror="this.style.display='none'">` : ''}
            <div class="osd-programme-info">
              <div class="osd-programme-title">${catchup.title}</div>
              <div class="osd-programme-time">
                ${formatTime(start)} - ${formatTime(end)}
                <span class="osd-remaining">${duration}</span>
              </div>
            </div>
          </div>
          <div class="osd-progress-row">
            <span class="osd-time-current">${formatTime(start)}</span>
            <div class="osd-progress">
              <div class="osd-progress-bar" style="width: ${progress * 100}%"></div>
            </div>
            <span class="osd-time-end">${formatTime(end)}</span>
          </div>
          ${catchup.description ? `<div class="osd-description">${catchup.description}</div>` : ''}
        </div>
      `;
    } else {
      // Live playback: show current EPG info
      const epgId = EpgService.findChannelId(ch);
      const nowPlaying = epgId ? EpgService.getNowPlaying(epgId) : null;
      const upcoming = epgId ? EpgService.getUpcoming(epgId, 1) : [];

      if (nowPlaying) {
        const progress = getProgress(nowPlaying.start, nowPlaying.stop);
        const remaining = formatDuration(nowPlaying.stop.getTime() - Date.now());
        const nowTime = formatTime(new Date());
        programmeHtml = `
          <div class="osd-programme">
            <div class="osd-now-label">NOW</div>
            <div class="osd-programme-detail">
              ${nowPlaying.icon ? `<img class="osd-programme-icon" src="${nowPlaying.icon}" alt="" onerror="this.style.display='none'">` : ''}
              <div class="osd-programme-info">
                <div class="osd-programme-title">${nowPlaying.title}</div>
                <div class="osd-programme-time">
                  ${formatTime(nowPlaying.start)} - ${formatTime(nowPlaying.stop)}
                  <span class="osd-remaining">${remaining} remaining</span>
                </div>
              </div>
            </div>
            <div class="osd-progress-row">
              <span class="osd-time-current">${nowTime}</span>
              <div class="osd-progress">
                <div class="osd-progress-bar" style="width: ${progress * 100}%"></div>
              </div>
              <span class="osd-time-end">${formatTime(nowPlaying.stop)}</span>
            </div>
            ${nowPlaying.description ? `<div class="osd-description">${nowPlaying.description}</div>` : ''}
          </div>
        `;
        if (upcoming.length) {
          programmeHtml += `
            <div class="osd-next">
              <span class="osd-next-label">NEXT</span>
              <span class="osd-next-title">${upcoming[0].title} <span class="osd-next-time">${formatTime(upcoming[0].start)}</span></span>
            </div>
          `;
        }
      }
    }

    osd.innerHTML = `
      <div class="osd-channel">
        <div class="osd-channel-number">${this.currentIndex + 1}</div>
        ${ch.logo ? `<img class="osd-channel-logo" src="${ch.logo}" alt="">` : ''}
        <div class="osd-channel-name">${ch.name}</div>
      </div>
      ${programmeHtml}
    `;
  }

  private updateOSDMessage(message: string): void {
    const osd = $('#player-osd', this.container);
    if (osd) {
      osd.innerHTML = `<div class="osd-message">${message}</div>`;
      show(osd);
    }
  }

  channelUp(): void {
    const len = PlaylistService.channels.length;
    if (!len) return;
    this.play((this.currentIndex + 1) % len);
  }

  channelDown(): void {
    const len = PlaylistService.channels.length;
    if (!len) return;
    this.play((this.currentIndex - 1 + len) % len);
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  handleAction(action: Action): void {
    switch (action) {
      case 'back':
      case 'stop':
        this.stop();
        this.onBack();
        break;
      case 'select':
        this.toggleOSD();
        break;
      case 'up':
      case 'channel_up':
        this.channelUp();
        break;
      case 'down':
      case 'channel_down':
        this.channelDown();
        break;
      case 'yellow':
        this.showOSD();
        break;
    }
  }
}
