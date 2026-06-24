import type { Action, Channel, CatchupInfo } from '../types';
import { $, show, hide, html, Safe } from '../utils/dom';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { StorageService } from '../services/storage-service';
import { CONFIG } from '../config';
import { formatTime, formatPosition, formatDuration, getProgress } from '../utils/time';
import { getLenientLoaders } from '../utils/hls-stable-loader';
import { createLogger } from '../utils/logger';

const log = createLogger('Player');

// True on the TV's webOS WebView; false in desktop preview / tests.
const isWebOS = /webOS|Web0S/i.test(navigator.userAgent);

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
  private pointerX: number | null = null;
  private pointerY: number | null = null;
  private osdTimer: ReturnType<typeof setTimeout> | null = null;
  private wasPlayingBeforeHide = false;
  private loadToken = 0;
  private hlsRecoveries = 0; // fatal hls.js errors recovered since the last good fragment
  constructor(container: HTMLElement, onBack: () => void) {
    this.container = container;
    this.onBack = onBack;
  }

  init(videoEl: HTMLVideoElement): void {
    this.videoEl = videoEl;
    this.bindVideoEvents(videoEl);

    // Pointer seeking. The Magic Remote OK over the bar may arrive as a click
    // (whose target can be the native video plane, not the bar) or as a keydown
    // 'select' — so seek by pointer COORDINATES over the bar, not the event target.
    this.container.addEventListener('mousemove', (e: MouseEvent) => {
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      // An active cursor reveals the OSD (and its seek bar) so there's something
      // to aim at; keep it up while the cursor keeps moving.
      if (this.osdVisible) this.resetOsdTimer(); else this.showOSD();
    });
    // The Magic Remote OK over the bar fires mousedown/up (and pointer events)
    // but NOT a synthesized click — so seek on mouseup, by coordinates.
    this.container.addEventListener('mouseup', (e: MouseEvent) => this.seekAtPointer(e.clientX, e.clientY));

    // Suspend/resume playback when the app is actually backgrounded so the
    // native media pipeline (a separate process) stops pulling segments off the
    // network. Drive this off visibilitychange ONLY: a real background (Home /
    // app switch) flips visibilityState to 'hidden', whereas the TV's Quick
    // Settings overlay merely blurs the window — we stay 'visible' behind it.
    // Suspending on blur is what blacked the app out when settings opened, and
    // getForegroundAppInfo (the precise signal) is a privileged Luna method this
    // app isn't allowed to call.
    const onHidden = (src: string) => { log.debug('suspend trigger:', src); this.suspend(); };
    const onVisible = (src: string) => { log.debug('resume trigger:', src); this.resume(); };

    document.addEventListener('visibilitychange', () => {
      log.debug('visibilitychange →', document.visibilityState);
      if (document.hidden) onHidden('visibilitychange'); else onVisible('visibilitychange');
    });
    document.addEventListener('webkitvisibilitychange', () => {
      if ((document as unknown as Record<string, boolean>).webkitHidden) onHidden('webkitvisibilitychange');
      else onVisible('webkitvisibilitychange');
    });
  }

  private bindVideoEvents(el: HTMLVideoElement): void {
    el.addEventListener('error', () => this.onError());
    el.addEventListener('loadedmetadata', () =>
      log.info('loadedmetadata', el.videoWidth + 'x' + el.videoHeight, '| duration:', el.duration));
    el.addEventListener('playing', () => log.info('playing'));
    el.addEventListener('waiting', () => log.debug('waiting (buffering)'));
    el.addEventListener('stalled', () => log.warn('stalled'));
    el.addEventListener('timeupdate', () => this.refreshProgress());
    el.addEventListener('ended', () => this.onEnded());
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
      this.recreateVideoEl();
    }
  }

  /**
   * Destroy the native media pipeline by swapping in a fresh <video> element.
   * On webOS the pipeline runs in a separate process and survives src changes —
   * and after a VOD reaches `ended` it stays terminal *and* keeps its whole
   * buffer, so the next stream won't start on the same element. A fresh element
   * kills the pipeline and frees it.
   */
  private recreateVideoEl(): void {
    const old = this.videoEl;
    if (!old) return;
    old.pause();
    old.removeAttribute('src');
    old.innerHTML = '';
    old.load();
    const fresh = document.createElement('video');
    fresh.id = old.id;
    fresh.autoplay = true;
    this.bindVideoEvents(fresh);
    old.parentNode!.replaceChild(fresh, old);
    this.videoEl = fresh;
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
    if (!channel || !this.videoEl) {
      log.warn('play() ignored — no channel or video element', { channelIndex, hasChannel: !!channel });
      return;
    }

    log.info('play index', channelIndex, '|', channel.name, catchup ? '(catchup)' : '');
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
      log.debug('catchup URL:', url);
    }

    this.videoEl.classList.add('active');
    this.loadStream(url, channel.extras);
    this.showOSD();
    show(this.container);
  }

  // A finished catch-up VOD would otherwise freeze on its last frame; fall back
  // to the channel's live stream instead.
  private onEnded(): void {
    if (this.catchupInfo && this.currentIndex >= 0) {
      log.info('catch-up ended — resuming live');
      this.recreateVideoEl();
      this.play(this.currentIndex);
    }
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

    const isTsUrl = url.endsWith('.ts') || url.includes('.ts?');
    const isFlvUrl = url.endsWith('.flv') || url.includes('.flv?');

    // webOS: the TV's hardware HLS/TS decoders beat MSE libraries, so play
    // natively. The URL is enough to pick the <source> MIME (extension-less
    // proxied streams default to HLS) and it avoids an extra round-trip per zap.
    if (isWebOS) {
      const mime = isFlvUrl ? 'video/x-flv' : isTsUrl ? 'video/mp2t' : 'application/vnd.apple.mpegurl';
      log.info('loadStream url=', url, '| webOS native | catchup:', !!this.catchupInfo, '| MIME', mime);
      this.playNative(url, mime);
      return;
    }

    // Desktop preview: native HLS is unreliable across Chrome/Firefox/Linux, so
    // always route through hls.js/mpegts.js. URL extensions lie — some providers
    // serve HLS with no .m3u8 suffix — so classify by the server's Content-Type,
    // falling back to the URL and defaulting to HLS.
    const token = ++this.loadToken;
    this.detectContentType(url).then(ct => {
      if (token !== this.loadToken || !this.videoEl) return; // superseded by a newer load
      const isFlv = isFlvUrl || ct.includes('flv');
      const isTs = isTsUrl || ct.includes('mp2t');
      const isDirect = !isTs && !isFlv && /^(?:video|audio)\//.test(ct);
      const isHls = !isTs && !isFlv && !isDirect; // proxied / extension-less ⇒ HLS
      log.info('loadStream url=', url, '| content-type:', ct || '(none)', '| catchup:', !!this.catchupInfo,
        '| isHls:', isHls, '| isTs:', isTs, '| isFlv:', isFlv);
      if (isTs || isFlv) {
        log.info('Using mpegts.js');
        this.loadWithMpegts(url, isFlv);
      } else if (isDirect) {
        log.info('Using direct video src');
        this.videoEl.src = url;
        this.videoEl.play().catch(e => log.warn('Direct play() rejected:', e));
      } else {
        log.info('Using hls.js');
        this.loadWithHls(url, extras);
      }
    });
  }

  // Classify a stream by the server's Content-Type — URL extensions are
  // unreliable for proxied/extension-less streams, so the response header is the
  // real signal. Headers are enough, so cancel the body. Returns '' on a
  // CORS/network failure, leaving the caller on its URL heuristic (default HLS).
  private async detectContentType(url: string): Promise<string> {
    try {
      const res = await fetch(url);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      res.body?.cancel().catch(() => {});
      return ct;
    } catch {
      return '';
    }
  }

  private playNative(url: string, mime: string): void {
    if (!this.videoEl) return;
    // A <source> with an explicit MIME tells the player the format even when the
    // URL has no file extension.
    this.videoEl.removeAttribute('src');
    this.videoEl.innerHTML = '';
    const source = document.createElement('source');
    source.src = url;
    source.type = mime;
    this.videoEl.appendChild(source);
    this.videoEl.load();
    this.videoEl.play().catch(e => log.warn('Native play() rejected:', e));
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

      // Stable-URI loaders so a rotating-URL live window doesn't trip hls.js.
      const loaders = getLenientLoaders(Hls);
      hlsConfig.pLoader = loaders.pLoader;
      hlsConfig.fLoader = loaders.fLoader;

      if (extras?.['http-user-agent']) {
        hlsConfig.xhrSetup = (xhr: XMLHttpRequest) => {
          xhr.setRequestHeader('User-Agent', extras['http-user-agent']);
        };
      }

      this.hlsRecoveries = 0;
      this.hls = new Hls(hlsConfig);
      this.hls.loadSource(url);
      this.hls.attachMedia(this.videoEl);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        log.info('hls.js MANIFEST_PARSED — starting playback');
        this.videoEl?.play().catch(e => log.warn('hls play() rejected:', e));
      });
      // A good fragment played: the stream recovered, so refill the retry budget.
      this.hls.on(Hls.Events.FRAG_BUFFERED, () => { this.hlsRecoveries = 0; });
      // Bounded recovery: retry transient network/media errors (and rotating-URL
      // re-fetches) a few times, but give up on a genuinely dead stream so it
      // zaps to the next channel instead of retrying forever.
      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        log.warn('hls.js error', { type: data.type, details: data.details, fatal: data.fatal });
        if (!data.fatal) return;
        if (this.hlsRecoveries >= CONFIG.PLAYER.HLS_MAX_RECOVERIES) { this.onError(); return; }
        this.hlsRecoveries++;
        const n = `${this.hlsRecoveries}/${CONFIG.PLAYER.HLS_MAX_RECOVERIES}`;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          log.info(`hls.js fatal network error — restarting load (${n})`);
          this.hls?.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          log.info(`hls.js fatal media error — recovering (${n})`);
          this.hls?.recoverMediaError();
        } else {
          this.onError();
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
    const v = this.videoEl;
    log.error('video error', v?.error ? { code: v.error.code, message: v.error.message } : 'no error info',
      '| channel:', this.currentChannel?.name, '| url:', this.currentChannel?.url);
    this.updateOSDMessage('Stream error - trying next channel...');
    setTimeout(() => this.channelUp(), 2000);
  }

  showOSD(): void {
    this.osdVisible = true;
    this.renderOSD();
    show($('#player-osd', this.container));
    this.resetOsdTimer();
  }

  private resetOsdTimer(): void {
    if (this.osdTimer) clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.hideOSD(), CONFIG.PLAYER.OSD_TIMEOUT);
  }

  /** Catch-up VOD is seekable while the OSD (the seek UI) is showing. */
  canSeek(): boolean {
    const v = this.videoEl;
    return this.osdVisible && !!this.catchupInfo && !!v
      && Number.isFinite(v.duration) && v.duration > 0;
  }

  seekBy(seconds: number): void {
    this.seekTo((this.videoEl?.currentTime ?? 0) + seconds);
  }

  /** Seek to a fraction (0..1) of the duration. */
  private seekToFraction(fraction: number): void {
    const v = this.videoEl;
    if (v && Number.isFinite(v.duration)) this.seekTo(Math.max(0, Math.min(1, fraction)) * v.duration);
  }

  /** Seek to the bar position under (x, y) when it's over the seek bar; returns
   *  whether it seeked. Used by both pointer clicks and OK over the bar. */
  private seekAtPointer(x: number | null, y: number | null): boolean {
    const v = this.videoEl;
    if (x === null || y === null || !v || !this.canSeek()) return false;
    const bar = $('[data-seekbar]', this.container) as HTMLElement | null;
    if (!bar) return false;
    const r = bar.getBoundingClientRect();
    const M = 20; // vertical slack so a near-miss with the imprecise cursor still counts
    const hit = r.width > 0 && x >= r.left && x <= r.right && y >= r.top - M && y <= r.bottom + M;
    if (!hit) return false;
    this.seekToFraction((x - r.left) / r.width);
    return true;
  }

  private seekTo(time: number): void {
    const v = this.videoEl;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    v.currentTime = Math.max(0, Math.min(v.duration, time));
    if (this.osdVisible) this.resetOsdTimer(); else this.showOSD();
    this.refreshProgress();
  }

  /** Live-update the bar + elapsed label in place (on timeupdate / after a seek). */
  private refreshProgress(): void {
    const v = this.videoEl;
    if (!this.osdVisible || !this.catchupInfo || !v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const bar = $('.osd-progress-bar', this.container) as HTMLElement | null;
    if (bar) bar.style.width = `${(Math.min(v.currentTime, v.duration) / v.duration) * 100}%`;
    const cur = $('.osd-time-current', this.container);
    if (cur) cur.textContent = formatPosition(v.currentTime);
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

    let programmeHtml: string | Safe = '';
    if (catchup) {
      // Catch-up playback: show the selected programme's info. The bar tracks the
      // video's playback position (a seekable VOD), not wall-clock time.
      const start = new Date(catchup.start * 1000);
      const end = new Date(catchup.end * 1000);
      const v = this.videoEl;
      const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (catchup.end - catchup.start);
      const pos = v ? Math.min(v.currentTime || 0, dur) : 0;
      const progress = dur > 0 ? pos / dur : 0;
      const duration = formatDuration(end.getTime() - start.getTime());
      programmeHtml = html`
        <div class="osd-programme">
          <div class="osd-now-label">CATCH-UP</div>
          <div class="osd-programme-detail">
            ${catchup.icon ? html`<img class="osd-programme-icon" src="${catchup.icon}" alt="" onerror="this.style.display='none'">` : ''}
            <div class="osd-programme-info">
              <div class="osd-programme-title">${catchup.title}</div>
              <div class="osd-programme-time">
                ${formatTime(start)} - ${formatTime(end)}
                <span class="osd-remaining">${duration}</span>
              </div>
            </div>
          </div>
          <div class="osd-progress-row">
            <span class="osd-time-current">${formatPosition(pos)}</span>
            <div class="osd-progress" data-seekbar>
              <div class="osd-progress-bar" style="width: ${progress * 100}%"></div>
            </div>
            <span class="osd-time-end">${formatPosition(dur)}</span>
          </div>
          ${catchup.description ? html`<div class="osd-description">${catchup.description}</div>` : ''}
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
        const next = upcoming.length ? html`
            <div class="osd-next">
              <span class="osd-next-label">NEXT</span>
              <span class="osd-next-title">${upcoming[0].title} <span class="osd-next-time">${formatTime(upcoming[0].start)}</span></span>
            </div>
          ` : '';
        programmeHtml = html`
          <div class="osd-programme">
            <div class="osd-now-label">NOW</div>
            <div class="osd-programme-detail">
              ${nowPlaying.icon ? html`<img class="osd-programme-icon" src="${nowPlaying.icon}" alt="" onerror="this.style.display='none'">` : ''}
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
            ${nowPlaying.description ? html`<div class="osd-description">${nowPlaying.description}</div>` : ''}
          </div>
          ${next}
        `;
      }
    }

    osd.innerHTML = String(html`
      <div class="osd-channel">
        <div class="osd-channel-number">${this.currentIndex + 1}</div>
        ${ch.logo ? html`<img class="osd-channel-logo" src="${ch.logo}" alt="">` : ''}
        <div class="osd-channel-name">${ch.name}</div>
      </div>
      ${programmeHtml}
    `);
  }

  private updateOSDMessage(message: string): void {
    const osd = $('#player-osd', this.container);
    if (osd) {
      osd.innerHTML = String(html`<div class="osd-message">${message}</div>`);
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
    // Any non-OK button means 5-way/button input, so a tracked cursor position
    // is stale — drop it so OK toggles the OSD rather than seeking.
    if (action !== 'select') { this.pointerX = null; this.pointerY = null; }
    switch (action) {
      case 'back':
      case 'stop':
        this.stop();
        this.onBack();
        break;
      case 'select':
        if (!this.seekAtPointer(this.pointerX, this.pointerY)) this.toggleOSD();
        break;
      case 'left':
        this.seekBy(-CONFIG.PLAYER.SEEK_STEP);
        break;
      case 'right':
        this.seekBy(CONFIG.PLAYER.SEEK_STEP);
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
