import type { Action, Channel, CatchupInfo, AudioTrackOption, AudioOption, AudioPref, ManifestAudio,
  SubtitleTrackOption, SubtitleOption, SubtitlePref, ManifestSubtitle, ManifestClosedCaption } from '../types';
import { $, show, hide, html, Safe } from '../utils/dom';
import { channelKey } from '../utils/channel';
import { morph } from '../utils/morph';
import { dvrWindow, dvrState, type DvrWindow, type DvrState } from '../utils/dvr';
import { fetchText } from '../utils/fetch-helper';
import { audioLabel, hlsAudioOptions, nativeAudioOptions, chooseAudioIndex, isPrefMatch, parseAudioRenditions, mergeManifestNames } from '../utils/audio-tracks';
import { subtitleLabel, hlsSubtitleOptions, manifestSubtitleOptions, chooseSubtitleIndex, isSubtitlePrefMatch, parseSubtitleRenditions, parseClosedCaptions, closedCaptionLabel } from '../utils/subtitle-tracks';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { StorageService } from '../services/storage-service';
import { HlsSubtitles } from '../services/hls-subtitles';
import { CONFIG } from '../config';
import { formatTime, formatPosition, formatDuration, getProgress } from '../utils/time';
import { getLenientLoaders } from '../utils/hls-stable-loader';
import { StallWatchdog, type StallProbe } from '../utils/stall-watchdog';
import { resolutionBadge, hdrLabel, frameRateLabel, parseVariants, pickVariant, codecName, audioSummary, subtitleSummary, type StreamVariant } from '../utils/stream-info';
import { createLogger } from '../utils/logger';
import { showToast } from './toast';

const log = createLogger('Player');

// True on the TV's webOS WebView; false in desktop preview / tests.
const isWebOS = /webOS|Web0S/i.test(navigator.userAgent);

// Picker sentinel for the in-band CEA-608/708 toggle. -1 is the synthetic "Off"
// row; -2 is the single closed-caption entry, drawn by the native compositor via
// setSubtitleEnable (channel selection is impossible — selectTrack decode-freezes).
const CC_SUBTITLE_INDEX = -2;

// hls.js and mpegts.js are loaded as globals via preview-libs.js (desktop preview only)
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
  private pointerBound = false;
  private dvrPauseTick: ReturnType<typeof setInterval> | null = null;
  // Programme-icon URLs that failed to load, so a re-render omits them instead of
  // re-requesting a broken image (which would thrash the OSD layout).
  private failedIcons = new Set<string>();
  private loadToken = 0;
  private hlsRecoveries = 0; // fatal hls.js errors recovered since the last good fragment
  private manifestAudio: ManifestAudio[] = []; // real track names parsed from the HLS master (webOS)
  private manifestSubtitles: ManifestSubtitle[] = []; // subtitle names parsed from the HLS master (webOS)
  private manifestClosedCaptions: ManifestClosedCaption[] = []; // CEA-608/708 declared in the HLS master (webOS)
  private ccEnabled = false; // live state of the native caption compositor (setSubtitleEnable)
  private selfRenderIndex = -1; // manifest subtitle rendition currently self-rendered (-1 = off)
  private masterUrl = ''; // HLS master URL of the active stream, for re-pointing self-render
  private manifestVariants: StreamVariant[] = []; // HLS master variants for best-effort codec readout
  private manifestSeq = 0;
  private subs = new HlsSubtitles(); // self-rendered subtitles on the webOS native path
  private stallWatchdog: StallWatchdog;
  constructor(container: HTMLElement, onBack: () => void) {
    this.container = container;
    this.onBack = onBack;
    this.stallWatchdog = new StallWatchdog({
      probe: (): StallProbe => {
        const v = this.videoEl;
        // No element -> report "paused" so a stray tick is a no-op.
        if (!v) return { currentTime: 0, readyState: 0, paused: true, seeking: false };
        return { currentTime: v.currentTime, readyState: v.readyState, paused: v.paused, seeking: v.seeking };
      },
      onReload: () => this.reloadCurrentStream(),
      onEscalate: () => this.channelUp(),
      pollMs: CONFIG.PLAYER.STALL_POLL_MS,
      freezeTicks: CONFIG.PLAYER.STALL_FREEZE_TICKS,
      maxReloads: CONFIG.PLAYER.STALL_MAX_RELOADS,
    });
  }

  init(videoEl: HTMLVideoElement): void {
    this.videoEl = videoEl;
    this.bindVideoEvents(videoEl);

    // Pointer input (desktop mouse + Magic Remote). The Magic Remote OK fires
    // mousedown/up (and pointer events) but NOT a synthesized click, and its
    // target can be the video plane — so act on mouseup by COORDINATES, not the
    // event target. Bound once (init() can re-run on a fresh <video>): the
    // handlers read this.videoEl live and the container is stable.
    if (!this.pointerBound) {
      this.pointerBound = true;
      this.container.addEventListener('mousemove', (e: MouseEvent) => {
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;
        // An active cursor reveals the OSD (and its controls) so there's
        // something to aim at; keep it up while the cursor keeps moving.
        if (this.osdVisible) this.resetOsdTimer(); else this.showOSD();
      });
      this.container.addEventListener('mouseup', (e: MouseEvent) => this.onPointerRelease(e.clientX, e.clientY));

      // A broken programme icon: record its URL (capture — `error` doesn't bubble)
      // and re-render so morph drops it and never re-requests it.
      this.container.addEventListener('error', (e: Event) => {
        const t = e.target as HTMLElement | null;
        if (!(t instanceof HTMLImageElement) || !t.classList.contains('osd-programme-icon')) return;
        const src = t.getAttribute('src');
        if (src && !this.failedIcons.has(src)) {
          this.failedIcons.add(src);
          if (this.osdVisible) this.renderOSD();
        }
      }, true);
    }

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
    el.addEventListener('loadedmetadata', () => {
      log.info('loadedmetadata', el.videoWidth + 'x' + el.videoHeight, '| duration:', el.duration);
      this.applyNativeAudioSelection();
      this.applyNativeSubtitleSelection();
      if (this.osdVisible) this.renderOSD();
    });
    // Intrinsic size changes mid-stream (ABR up/down-switch) so the OSD pills
    // (resolution, and on hls.js the codec/HDR/fps) reflect the live variant.
    el.addEventListener('resize', () => {
      if (this.osdVisible) this.renderOSD();
    });
    // Some platforms populate audio/text tracks asynchronously, after loadedmetadata.
    el.audioTracks?.addEventListener?.('addtrack', () => this.applyNativeAudioSelection());
    el.textTracks?.addEventListener?.('addtrack', () => this.applyNativeSubtitleSelection());
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
      this.stallWatchdog.stop();
      this.subs.stop();
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

  // Resolve the playable URL for a channel, applying the catch-up template when
  // a catch-up window is active. Shared by play() and the stall reload path.
  private resolveStreamUrl(channel: Channel, catchup: CatchupInfo | null): string {
    if (catchup && channel.catchupSource) {
      return channel.catchupSource
        .replace('{channel-id}', encodeURIComponent(channel.id || channel.name))
        .replace('{utc}', String(catchup.start))
        .replace('{utcend}', String(catchup.end));
    }
    return channel.url;
  }

  play(channelIndex: number, catchup?: CatchupInfo): void {
    this.stallWatchdog.stop();
    const channel = PlaylistService.getByIndex(channelIndex);
    if (!channel || !this.videoEl) {
      log.warn('play() ignored — no channel or video element', { channelIndex, hasChannel: !!channel });
      return;
    }

    log.info('play index', channelIndex, '|', channel.name, catchup ? '(catchup)' : '');
    this.currentChannel = channel;
    this.currentIndex = channelIndex;
    this.catchupInfo = catchup || null;
    this.failedIcons.clear(); // fresh icon-load attempts per channel/programme visit
    StorageService.setLastChannel(channelIndex);

    const url = this.resolveStreamUrl(channel, catchup || null);
    if (catchup) log.debug('catchup URL:', url);

    this.videoEl.classList.add('active');
    this.loadStream(url, channel.extras);
    this.showOSD();
    show(this.container);
    if (isWebOS) this.stallWatchdog.start();
  }

  // Stall watchdog recovery: swap in a fresh <video> (kills the wedged native
  // pipeline) and reload the current channel WITHOUT going through play() — that
  // would reset the watchdog's reload budget and prevent escalation.
  private reloadCurrentStream(): void {
    if (!this.currentChannel || this.currentIndex < 0) return;
    log.warn('stall watchdog — reloading current stream:', this.currentChannel.name);
    this.updateOSDMessage('Reconnecting…');
    this.recreateVideoEl();
    this.videoEl?.classList.add('active');
    this.loadStream(this.resolveStreamUrl(this.currentChannel, this.catchupInfo), this.currentChannel.extras);
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
    this.stallWatchdog.stop();
    this.subs.stop();
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
    this.manifestAudio = [];
    this.manifestSubtitles = [];
    this.manifestClosedCaptions = [];
    this.ccEnabled = false; // fresh pipeline — captions start off (608 doesn't auto-draw)
    this.selfRenderIndex = -1;
    this.masterUrl = '';
    this.manifestVariants = [];
    this.subs.stop();

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
      // HLS only: read the master's EXT-X-MEDIA audio/subtitle names — native
      // audio/text tracks expose them with empty name/language on webOS.
      if (!isTsUrl && !isFlvUrl) void this.loadManifestTracks(url, ++this.manifestSeq);
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
      // The audio/subtitle track lists aren't ready at MANIFEST_PARSED — hls.js
      // fills them and fires their *_TRACKS_UPDATED events separately, so apply
      // the saved picks there.
      this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.applyHlsAudioSelection());
      this.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.applyHlsSubtitleSelection());
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
    // Keep the OSD up while paused (live DVR or catch-up): nothing to fall behind.
    if (this.videoEl?.paused) return;
    this.osdTimer = setTimeout(() => this.hideOSD(), CONFIG.PLAYER.OSD_TIMEOUT);
  }

  /** The live DVR window (seekable timeshift) when playing live with a usable
   *  retained window; null for catch-up VOD or a non-DVR live stream. */
  private liveDvrWindow(): DvrWindow | null {
    const v = this.videoEl;
    if (!v || this.catchupInfo) return null;
    return dvrWindow(v.seekable, v.duration, CONFIG.PLAYER.DVR_MIN_WINDOW);
  }

  isLiveDvr(): boolean {
    return !!this.liveDvrWindow();
  }

  /** Seekable while the OSD (the seek UI) shows: catch-up VOD, or live DVR. */
  canSeek(): boolean {
    const v = this.videoEl;
    if (!this.osdVisible || !v) return false;
    if (this.catchupInfo) return Number.isFinite(v.duration) && v.duration > 0;
    return this.isLiveDvr();
  }

  seekBy(seconds: number): void {
    this.seekTo((this.videoEl?.currentTime ?? 0) + seconds);
  }

  /** Seek to a fraction (0..1) of the seekable range (DVR window or VOD duration). */
  private seekToFraction(fraction: number): void {
    const v = this.videoEl;
    if (!v) return;
    const f = Math.max(0, Math.min(1, fraction));
    const win = this.liveDvrWindow();
    if (win) this.seekTo(win.start + f * win.length);
    else if (Number.isFinite(v.duration)) this.seekTo(f * v.duration);
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

  /** A pointer release (mouse or Magic Remote OK): seek if it landed on the bar,
   *  else activate the play/pause or Go-to-Live control under it. Coordinate-based
   *  because the Magic Remote OK fires no click and its target may be the video. */
  private onPointerRelease(x: number, y: number): void {
    if (this.seekAtPointer(x, y)) return;
    if (this.hitsControl('[data-playpause]', x, y)) this.pauseToggle();
    else if (this.hitsControl('[data-golive]', x, y)) this.goToLive();
  }

  private hitsControl(selector: string, x: number, y: number): boolean {
    const el = $(selector, this.container) as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private seekTo(time: number): void {
    const v = this.videoEl;
    if (!v) return;
    const win = this.liveDvrWindow();
    if (win) {
      // Live DVR: clamp within the retained window; seeking to/near the edge snaps
      // to the live edge (a small pad back so playback does not stall at the tip).
      const liveEdge = win.end - CONFIG.PLAYER.DVR_GO_LIVE_PAD;
      v.currentTime = time >= liveEdge ? liveEdge : Math.max(win.start, time);
    } else if (Number.isFinite(v.duration) && v.duration > 0) {
      v.currentTime = Math.max(0, Math.min(v.duration, time));
    } else {
      return;
    }
    if (this.osdVisible) this.resetOsdTimer(); else this.showOSD();
    this.refreshProgress();
  }

  private goToLive(): void {
    const win = this.liveDvrWindow();
    if (win) this.seekTo(win.end);
  }

  private goToOldest(): void {
    const win = this.liveDvrWindow();
    if (win) this.seekTo(win.start);
  }

  /** Pause/resume. On live DVR, if the retained window rolled past the paused
   *  point, resume from the oldest available point rather than a dropped segment. */
  private pauseToggle(): void {
    const v = this.videoEl;
    if (!v) return;
    if (v.paused) {
      const win = this.liveDvrWindow();
      if (win && v.currentTime < win.start) v.currentTime = win.start;
      v.play?.().catch(() => {});
      this.stopDvrPauseTick();
    } else {
      v.pause?.();
      if (this.isLiveDvr()) this.startDvrPauseTick();
    }
    if (this.osdVisible) { this.renderOSD(); this.resetOsdTimer(); } else this.showOSD();
  }

  // While paused on live DVR the window keeps rolling forward, so tick the OSD
  // to keep "behind live" and the cursor accurate (timeupdate is silent paused).
  private startDvrPauseTick(): void {
    this.stopDvrPauseTick();
    this.dvrPauseTick = setInterval(() => {
      if (this.osdVisible && this.videoEl?.paused && this.isLiveDvr()) this.refreshProgress();
      else this.stopDvrPauseTick();
    }, 1000);
  }

  private stopDvrPauseTick(): void {
    if (this.dvrPauseTick) { clearInterval(this.dvrPauseTick); this.dvrPauseTick = null; }
  }

  /** Live-update the bar + labels in place (on timeupdate / after a seek). */
  private refreshProgress(): void {
    const v = this.videoEl;
    if (!this.osdVisible || !v) return;
    const win = this.liveDvrWindow();
    // DVR availability can flip after the OSD is already open (the seekable
    // window fills in a beat after tune-in). When the current layout no longer
    // matches, do a full render so the DVR bar appears/disappears on its own —
    // no close/reopen. [data-golive] exists only in the DVR layout.
    const hasDvrBar = !!$('[data-golive]', this.container);
    if (!!win !== hasDvrBar) { this.renderOSD(); return; }
    if (win) {
      const st = dvrState(win, v.currentTime, CONFIG.PLAYER.DVR_LIVE_EDGE);
      const bar = $('.osd-progress-bar', this.container) as HTMLElement | null;
      if (bar) bar.style.width = `${st.fraction * 100}%`;
      const behind = $('.osd-dvr-behind', this.container);
      if (behind) behind.textContent = st.atLiveEdge ? 'LIVE' : `-${formatPosition(st.behindLive)}`;
      const liveEl = $('.osd-dvr-live', this.container) as HTMLElement | null;
      if (liveEl) liveEl.classList.toggle('is-live', st.atLiveEdge);
      return;
    }
    if (!this.catchupInfo || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const bar = $('.osd-progress-bar', this.container) as HTMLElement | null;
    if (bar) bar.style.width = `${(Math.min(v.currentTime, v.duration) / v.duration) * 100}%`;
    const cur = $('.osd-time-current', this.container);
    if (cur) cur.textContent = formatPosition(v.currentTime);
  }

  hideOSD(): void {
    this.osdVisible = false;
    hide($('#player-osd', this.container));
    if (this.osdTimer) clearTimeout(this.osdTimer);
    this.stopDvrPauseTick();
  }

  private toggleOSD(): void {
    if (this.osdVisible) this.hideOSD();
    else this.showOSD();
  }

  /** The programme icon `<img>`, or nothing if it has no URL or that URL already
   *  failed to load. Keyed by URL so morph reuses a loaded icon across re-renders
   *  (no reload/flicker); a broken one is recorded by the delegated 'error'
   *  listener and omitted here on the next render. */
  private programmeIcon(url: string): Safe | string {
    if (!url || this.failedIcons.has(url)) return '';
    return html`<img class="osd-programme-icon" data-key="prog-icon:${url}" src="${url}" alt="">`;
  }

  /** The shared OSD play/pause button (live DVR and catch-up). Pointer-hit-tested
   *  by onPointerRelease and toggled by OK from handleAction. */
  private playPauseButton(): Safe {
    const paused = !!this.videoEl?.paused;
    return html`
      <button class="osd-dvr-btn" data-playpause aria-label="${paused ? 'Play' : 'Pause'}">
        ${paused
          ? html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
          : html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`}
      </button>
    `;
  }

  private dvrProgressRow(st: DvrState): Safe {
    return html`
      <div class="osd-progress-row osd-dvr-row">
        ${this.playPauseButton()}
        <span class="osd-time-current osd-dvr-behind">${st.atLiveEdge ? 'LIVE' : `-${formatPosition(st.behindLive)}`}</span>
        <div class="osd-progress" data-seekbar>
          <div class="osd-progress-bar" style="width: ${st.fraction * 100}%"></div>
        </div>
        <button class="osd-time-end osd-dvr-live ${st.atLiveEdge ? 'is-live' : ''}" data-golive aria-label="Go to live">LIVE</button>
      </div>
    `;
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
            ${this.programmeIcon(catchup.icon)}
            <div class="osd-programme-info">
              <div class="osd-programme-title">${catchup.title}</div>
              <div class="osd-programme-time">
                ${formatTime(start)} - ${formatTime(end)}
                <span class="osd-remaining">${duration}</span>
              </div>
            </div>
          </div>
          <div class="osd-progress-row">
            ${this.playPauseButton()}
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
      // Live playback. Show EPG programme info, and a DVR timeshift bar when the
      // stream exposes a usable seekable window.
      const win = this.liveDvrWindow();
      const st = win ? dvrState(win, this.videoEl!.currentTime, CONFIG.PLAYER.DVR_LIVE_EDGE) : null;
      const epgId = EpgService.findChannelId(ch);
      const nowPlaying = epgId ? EpgService.getNowPlaying(epgId) : null;
      const upcoming = epgId ? EpgService.getUpcoming(epgId, 1) : [];

      if (nowPlaying || st) {
        const next = upcoming.length ? html`
            <div class="osd-next">
              <span class="osd-next-label">NEXT</span>
              <span class="osd-next-title">${upcoming[0].title} <span class="osd-next-time">${formatTime(upcoming[0].start)}</span></span>
            </div>
          ` : '';
        const detail = nowPlaying ? html`
            <div class="osd-programme-detail">
              ${this.programmeIcon(nowPlaying.icon)}
              <div class="osd-programme-info">
                <div class="osd-programme-title">${nowPlaying.title}</div>
                <div class="osd-programme-time">
                  ${formatTime(nowPlaying.start)} - ${formatTime(nowPlaying.stop)}
                  <span class="osd-remaining">${formatDuration(nowPlaying.stop.getTime() - Date.now())} remaining</span>
                </div>
              </div>
            </div>` : '';
        const progressRow = st ? this.dvrProgressRow(st) : (nowPlaying ? html`
            <div class="osd-progress-row">
              <span class="osd-time-current">${formatTime(new Date())}</span>
              <div class="osd-progress">
                <div class="osd-progress-bar" style="width: ${getProgress(nowPlaying.start, nowPlaying.stop) * 100}%"></div>
              </div>
              <span class="osd-time-end">${formatTime(nowPlaying.stop)}</span>
            </div>` : '');
        programmeHtml = html`
          <div class="osd-programme">
            <div class="osd-now-label">${st && !st.atLiveEdge ? 'TIMESHIFT' : 'NOW'}</div>
            ${detail}
            ${progressRow}
            ${nowPlaying && nowPlaying.description ? html`<div class="osd-description">${nowPlaying.description}</div>` : ''}
          </div>
          ${next}
        `;
      }
    }

    const v = this.videoEl;
    const lvl = this.hls?.loadLevelObj;
    const badge = v ? resolutionBadge(v.videoHeight) : null;
    const variant = !this.hls && v ? pickVariant(this.manifestVariants, v.videoWidth, v.videoHeight) : null;
    const vCodec = codecName(lvl?.videoCodec ?? variant?.videoCodec ?? '');
    const aCodecName = codecName(lvl?.audioCodec ?? variant?.audioCodec ?? '');
    // Atmos (JOC): native path from the manifest variant's audio group; hls.js from
    // the active audio track's channel layout — loadLevelObj carries no channels.
    const hlsChannels = this.hls?.audioTracks?.[this.hls.audioTrack]?.channels ?? '';
    const atmos = variant?.atmos || /\bJOC\b/i.test(hlsChannels);
    const aCodec = aCodecName && atmos ? `${aCodecName} Atmos` : aCodecName;
    const hdr = hdrLabel(lvl?.videoRange ?? variant?.videoRange ?? '');
    const fps = frameRateLabel(lvl?.frameRate ?? variant?.frameRate ?? 0);
    const audio = audioSummary(this.getAudioTracks());
    const subtitle = subtitleSummary(this.getSubtitleTracks());
    const streamInfoHtml = (badge || hdr || fps || vCodec || aCodec || audio || subtitle) ? html`
      <div class="osd-stream-info">
        ${badge ? html`<span class="si-badge si-badge--${badge.tier}">${badge.label}</span>` : ''}
        ${hdr ? html`<span class="si-badge si-badge--hdr">${hdr}</span>` : ''}
        ${fps ? html`<span class="si-pill">${fps}fps</span>` : ''}
        ${vCodec ? html`<span class="si-pill">${vCodec}</span>` : ''}
        ${aCodec ? html`<span class="si-pill">${aCodec}</span>` : ''}
        ${audio ? html`<span class="si-text">${audio}</span>` : ''}
        ${subtitle ? html`<span class="si-text">CC: ${subtitle}</span>` : ''}
      </div>
    ` : '';

    morph(osd, html`
      <div class="osd-channel">
        <div class="osd-channel-number">${this.currentIndex + 1}</div>
        ${ch.logo ? html`<img class="osd-channel-logo" src="${ch.logo}" alt="">` : ''}
        <div class="osd-channel-name">${ch.name}</div>
        ${streamInfoHtml}
      </div>
      ${programmeHtml}
    `);
  }

  private updateOSDMessage(message: string): void {
    const osd = $('#player-osd', this.container);
    if (!osd) return;
    osd.innerHTML = String(html`<div class="osd-message">${message}</div>`);
    // osdVisible + timer so loadedmetadata repaints over this once the stream
    // recovers (else "Reconnecting…" sticks) and it auto-hides otherwise.
    this.osdVisible = true;
    show(osd);
    this.resetOsdTimer();
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

  /**
   * Normalized audio renditions of the active stream — from hls.js in the desktop
   * preview, or the native `HTMLMediaElement.audioTracks` on webOS (whose alternate
   * tracks come back empty-named, so real labels are overlaid from the parsed
   * manifest — see `loadManifestAudio`).
   */
  private audioOptions(): AudioOption[] {
    if (this.hls) return hlsAudioOptions(this.hls.audioTracks || [], this.hls.audioTrack);
    const list = this.videoEl?.audioTracks;
    if (!list) return [];
    return mergeManifestNames(nativeAudioOptions(list), this.manifestAudio);
  }

  // Fetch the HLS master once and parse its audio + subtitle rendition names so
  // the pickers, toasts and per-channel memory show real labels instead of
  // "Audio 2" / "Subtitle 2". Native audio/text tracks carry no usable
  // name/language on webOS, so this is the only source. Re-applies the saved
  // picks once names are known; degrades to generic labels on a fetch failure.
  private async loadManifestTracks(url: string, seq: number): Promise<void> {
    try {
      const text = await fetchText(url);
      if (seq !== this.manifestSeq) return;
      const audio = parseAudioRenditions(text);
      if (audio.length >= 2) {
        this.manifestAudio = audio;
        log.info('manifest audio:', audio.map(r => r.name || r.lang || '?').join(', '));
        this.applyNativeAudioSelection();
      }
      const subs = parseSubtitleRenditions(text);
      if (subs.length) {
        this.manifestSubtitles = subs;
        this.masterUrl = url;
        log.info('manifest subtitles:', subs.map(r => r.name || r.lang || '?').join(', '));
        // Off unless FORCED or a saved pick (spec-correct — see applySelfRenderSelection).
        this.applySelfRenderSelection();
      }
      const ccs = parseClosedCaptions(text);
      if (ccs.length) {
        this.manifestClosedCaptions = ccs;
        log.info('manifest closed captions:', ccs.map(c => c.instreamId || c.name || '?').join(', '));
        // Re-apply a saved CC choice now the manifest confirms captions exist.
        this.applyNativeSubtitleSelection();
      }
      const variants = parseVariants(text);
      if (variants.length) {
        this.manifestVariants = variants;
        log.info('manifest variants:', variants.length);
      }
    } catch (e) {
      log.warn('manifest tracks fetch failed:', e);
    }
  }

  // Picker-facing options. When webOS collapses same-language renditions (the
  // native list is shorter than the manifest), surface every manifest rendition
  // but mark the hidden ones unavailable — the TV can't switch to them, so the
  // picker grays them rather than pretending. `available` assumes the manifest
  // lists the native-exposed renditions first (default / first-per-language).
  private displayAudioOptions(): Array<AudioOption & { available: boolean }> {
    const opts = this.audioOptions();
    if (this.manifestAudio.length > opts.length) {
      return this.manifestAudio.map((m, i) => ({
        index: i, name: m.name, lang: m.lang, isDefault: m.isDefault,
        // Mark the playing native track, not the manifest DEFAULT flag — a
        // non-conformant playlist can carry >1 DEFAULT=YES (collapsed alternates),
        // which would otherwise check several rows at once.
        active: i < opts.length ? opts[i].active : false,
        available: i < opts.length,
      }));
    }
    return opts.map(o => ({ ...o, available: true }));
  }

  /** Audio tracks for the picker. Labels prefer name, then language, then a position. */
  getAudioTracks(): AudioTrackOption[] {
    return this.displayAudioOptions().map(o => ({
      index: o.index, label: audioLabel(o), active: o.active, available: o.available,
    }));
  }

  /** Switch the active audio track and remember it for this channel. No-op for a
   *  grayed (unavailable) track — webOS can't switch to a collapsed rendition. */
  selectAudioTrack(index: number): void {
    const opt = this.displayAudioOptions().find(o => o.index === index);
    if (!opt || !opt.available) return;
    if (this.hls) {
      if (index >= 0 && index < (this.hls.audioTracks?.length || 0)) this.hls.audioTrack = index;
    } else {
      const list = this.videoEl?.audioTracks;
      if (!list || index < 0 || index >= list.length) return;
      for (let i = 0; i < list.length; i++) list[i].enabled = (i === index);
    }
    this.rememberAudio(opt);
    showToast(`Switching audio track to ${audioLabel(opt)}`);
  }

  private channelPrefKey(): string {
    return this.currentChannel ? channelKey(this.currentChannel) : '';
  }

  private rememberAudio(opt: AudioOption): void {
    const key = this.channelPrefKey();
    if (key) StorageService.setAudioPref(key, { name: opt.name, lang: opt.lang });
    log.info('audio: user picked', opt.index, audioLabel(opt), key ? '— saved to storage' : '(no channel key, not saved)');
  }

  // Report the storage read and the resolved track on every tune-in — even when
  // no switch is needed (the chosen track is already active) — so the default
  // pick and the pref lookup are both visible in the log.
  private logAudioChoice(path: string, options: AudioOption[], pref: AudioPref | null, idx: number): void {
    const opt = options.find(o => o.index === idx);
    const label = opt ? audioLabel(opt) : `Audio ${idx + 1}`;
    log.info(`audio: ${path} | tracks:`, options.length,
      '| storage pref:', pref ? (pref.name || pref.lang || '(unnamed)') : 'none',
      '| using:', idx, label, isPrefMatch(opt, pref) ? '(saved pref)' : '(stream default)');
  }

  // Re-apply the remembered choice on tune-in; with no saved pick the stream
  // default stands. hls.js drives its own rendition, so the two paths are split.
  private applyHlsAudioSelection(): void {
    if (!this.hls) return;
    const options = this.audioOptions();
    if (options.length < 2) return;
    const pref = StorageService.getAudioPref(this.channelPrefKey());
    const idx = chooseAudioIndex(options, pref);
    this.logAudioChoice('hls', options, pref, idx);
    if (idx >= 0 && idx !== this.hls.audioTrack) this.hls.audioTrack = idx;
  }

  private applyNativeAudioSelection(): void {
    if (this.hls) return; // hls.js owns the rendition; videoEl exposes only the active one
    const list = this.videoEl?.audioTracks;
    if (!list || list.length < 2) return;
    const options = this.audioOptions();
    const pref = StorageService.getAudioPref(this.channelPrefKey());
    const idx = chooseAudioIndex(options, pref);
    this.logAudioChoice('native', options, pref, idx);
    if (idx < 0 || list[idx].enabled) return; // already active — don't disturb playback
    for (let i = 0; i < list.length; i++) list[i].enabled = (i === idx);
  }

  /**
   * Normalized subtitle renditions of the active stream — from hls.js in the
   * desktop preview, or the native `HTMLMediaElement.textTracks` on webOS (whose
   * tracks can come back empty-named, so real labels are overlaid from the parsed
   * manifest — see `loadManifestTracks`).
   */
  private subtitleOptions(): SubtitleOption[] {
    if (this.hls) return hlsSubtitleOptions(this.hls.subtitleTracks || [], this.hls.subtitleTrack);
    // webOS native: in-manifest WebVTT is self-rendered (not surfaced as switchable
    // textTracks), so the choices are the parsed master renditions and the active one
    // is what we self-render.
    return manifestSubtitleOptions(this.manifestSubtitles, this.selfRenderIndex);
  }

  // Picker-facing options. Unlike audio — where webOS collapses same-language
  // renditions so unreachable ones are grayed (displayAudioOptions) — every
  // subtitle rendition is self-renderable, so all are selectable.
  private displaySubtitleOptions(): Array<SubtitleOption & { available: boolean }> {
    return this.subtitleOptions().map(o => ({ ...o, available: true }));
  }

  /** Subtitle tracks for the picker (the menu prepends its own "Off" row). On the
   *  webOS native path a single "Closed Captions" toggle is appended when the
   *  manifest declares in-band CEA-608/708 — drawn by the native compositor. */
  getSubtitleTracks(): SubtitleTrackOption[] {
    const tracks: SubtitleTrackOption[] = this.displaySubtitleOptions().map(o => ({
      index: o.index, label: subtitleLabel(o), active: o.active, available: o.available,
    }));
    if (this.ccAvailable()) {
      tracks.push({
        index: CC_SUBTITLE_INDEX,
        label: closedCaptionLabel(this.manifestClosedCaptions),
        active: this.ccEnabled,
        available: true,
      });
    }
    return tracks;
  }

  // In-band CC is offered only on the native pipeline (setSubtitleEnable is a
  // webOS Luna verb) and only when the master advertises CLOSED-CAPTIONS.
  private ccAvailable(): boolean {
    return isWebOS && this.manifestClosedCaptions.length > 0;
  }

  /** Switch the active subtitle (index -1 = off, -2 = in-band CC) and remember it
   *  for this channel. No-op for a grayed (unavailable) track the platform didn't
   *  expose. CC and the other subtitle paths are mutually exclusive. */
  selectSubtitleTrack(index: number): void {
    if (index === CC_SUBTITLE_INDEX) {
      this.subs.stop();               // self-render and the native compositor can't both draw
      this.selfRenderIndex = -1;
      this.setNativeCC(true);
      this.rememberSubtitle({ off: false, cc: true, name: '', lang: '' });
      showToast(`Subtitles: ${closedCaptionLabel(this.manifestClosedCaptions)}`);
      return;
    }
    if (index === -1) {
      this.setNativeCC(false);
      this.applySubtitleChoice(-1);
      this.rememberSubtitle({ off: true, name: '', lang: '' });
      showToast('Subtitles off');
      return;
    }
    const opt = this.displaySubtitleOptions().find(o => o.index === index);
    if (!opt || !opt.available) return;
    this.setNativeCC(false);
    this.applySubtitleChoice(index);
    this.rememberSubtitle({ off: false, name: opt.name, lang: opt.lang });
    showToast(`Subtitles: ${subtitleLabel(opt)}`);
  }

  // Toggle the native caption compositor (CEA-608/708, also IMSC) via Luna. Only
  // fires on a real state change, and needs the pipeline's mediaId — exposed on
  // the native element once decoding starts. selectTrack is deliberately avoided:
  // it decode-freezes the video, so this is enable/disable only.
  private setNativeCC(enable: boolean): void {
    if (!isWebOS || enable === this.ccEnabled) return;
    const v = this.videoEl as (HTMLVideoElement & { mediaId?: string }) | null;
    const mediaId = v?.mediaId;
    if (!mediaId) { if (enable) log.warn('CC: no mediaId yet — will retry on track/metadata events'); return; }
    const w = window as unknown as {
      webOS?: { service?: { request?: (uri: string, opts: {
        method: string; parameters: unknown;
        onSuccess?: (r: unknown) => void; onFailure?: (e: unknown) => void;
      }) => void } };
    };
    const request = w.webOS?.service?.request;
    if (!request) return;
    request('luna://com.webos.media', {
      method: 'setSubtitleEnable',
      parameters: { mediaId, enable },
      onSuccess: () => log.info('CC: setSubtitleEnable', enable, 'ok'),
      onFailure: (e) => log.warn('CC: setSubtitleEnable failed:', JSON.stringify(e)),
    });
    this.ccEnabled = enable;
  }

  // Route a subtitle pick to the active engine (index -1 = off). hls.js (preview)
  // drives its own rendition; the webOS native path self-renders the chosen WebVTT
  // rendition. selectTrack is never used — it decode-freezes the video on webOS.
  private applySubtitleChoice(index: number): void {
    if (this.hls) {
      this.hls.subtitleDisplay = index >= 0;
      if (index < (this.hls.subtitleTracks?.length || 0)) this.hls.subtitleTrack = index;
      return;
    }
    const m = index >= 0 ? this.manifestSubtitles[index] : undefined;
    if (!m || !this.videoEl || !this.masterUrl) {
      this.subs.stop();
      this.selfRenderIndex = -1;
      return;
    }
    this.selfRenderIndex = index;
    void this.subs.start(this.videoEl, this.masterUrl, { name: m.name, lang: m.lang });
  }

  // Spec-correct tune-in default for self-rendered WebVTT: subtitles stay off
  // unless a rendition is FORCED, or the user saved a pick for this channel.
  // DEFAULT=YES does not auto-enable — per HLS it only marks the preferred
  // rendition once subtitles are on. A saved CC pick is applied separately.
  private applySelfRenderSelection(): void {
    if (this.hls) return;
    const pref = StorageService.getSubtitlePref(this.channelPrefKey());
    if (pref?.cc) { this.applySubtitleChoice(-1); return; } // CC path owns it
    const options = manifestSubtitleOptions(this.manifestSubtitles, this.selfRenderIndex);
    const idx = chooseSubtitleIndex(options, pref);
    this.logSubtitleChoice('self-render', options, pref, idx);
    this.applySubtitleChoice(idx);
  }

  private rememberSubtitle(pref: SubtitlePref): void {
    const key = this.channelPrefKey();
    if (key) StorageService.setSubtitlePref(key, pref);
    log.info('subtitle: user picked', pref.off ? 'Off' : (pref.name || pref.lang || '(unnamed)'),
      key ? '— saved to storage' : '(no channel key, not saved)');
  }

  private logSubtitleChoice(path: string, options: SubtitleOption[], pref: SubtitlePref | null, idx: number): void {
    const opt = options.find(o => o.index === idx);
    const label = idx < 0 ? 'Off' : opt ? subtitleLabel(opt) : `Subtitle ${idx + 1}`;
    const src = pref?.off ? '(off pref)' : isSubtitlePrefMatch(opt, pref) ? '(saved pref)' : '(stream default)';
    log.info(`subtitle: ${path} | tracks:`, options.length,
      '| storage pref:', pref ? (pref.off ? 'off' : (pref.name || pref.lang || '(unnamed)')) : 'none',
      '| using:', idx, label, src);
  }

  // Re-apply the remembered choice on tune-in. With no saved pick subtitles stay
  // off unless the stream marks one forced. hls.js drives its own rendition, so
  // the two paths are split like audio.
  private applyHlsSubtitleSelection(): void {
    if (!this.hls) return;
    const options = this.subtitleOptions();
    if (!options.length) return;
    const pref = StorageService.getSubtitlePref(this.channelPrefKey());
    const idx = chooseSubtitleIndex(options, pref);
    this.logSubtitleChoice('hls', options, pref, idx);
    this.hls.subtitleDisplay = idx >= 0;
    if (this.hls.subtitleTrack !== idx) this.hls.subtitleTrack = idx;
  }

  // Re-apply a remembered Closed-Captions choice once the pipeline/manifest
  // confirms captions exist (fires on loadedmetadata, an addtrack event, and
  // after the manifest parse). WebVTT is handled by applySelfRenderSelection.
  private applyNativeSubtitleSelection(): void {
    if (this.hls) return; // hls.js owns the rendition and its native text tracks
    const pref = StorageService.getSubtitlePref(this.channelPrefKey());
    if (this.ccAvailable() && pref?.cc) {
      this.subs.stop(); // self-render and the native compositor can't both draw
      this.selfRenderIndex = -1;
      this.setNativeCC(true);
    }
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
        if (this.seekAtPointer(this.pointerX, this.pointerY)) break;
        // OSD up on a pausable stream (live DVR or catch-up): OK pauses/resumes.
        if (this.canSeek()) this.pauseToggle();
        else this.toggleOSD();
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
      case 'play':
        if (this.videoEl?.paused) this.pauseToggle();
        break;
      case 'pause':
        if (this.videoEl && !this.videoEl.paused) this.pauseToggle();
        break;
      case 'rewind':
        this.goToOldest();
        break;
      case 'fast_forward':
        this.goToLive();
        break;
    }
  }
}
