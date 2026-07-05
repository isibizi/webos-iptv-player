// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { playlistMock } = vi.hoisted(() => ({
  playlistMock: { channels: [] as unknown[], getByIndex: vi.fn() },
}));

vi.mock('../services/playlist-service', () => ({ PlaylistService: playlistMock }));
vi.mock('../services/epg-service', () => ({
  EpgService: { findChannelId: () => null, getNowPlaying: () => null, getUpcoming: () => [] },
}));
vi.mock('../services/storage-service', () => ({
  StorageService: { setLastChannel: vi.fn(), getSubtitlePref: vi.fn(), setSubtitlePref: vi.fn(), getAudioPref: vi.fn() },
}));

import { Player } from './player';
import { StorageService } from '../services/storage-service';
import { CONFIG } from '../config';

const CHANNEL = {
  id: 'c1', name: 'Chan', logo: '', group: '', url: 'http://host/play/c1', extras: null,
  playlistIds: [], catchup: 'default', catchupSource: 'http://host/catchup/c1?start={utc}&end={utcend}', catchupDays: 7,
};
// 120-second catch-up programme.
const CATCHUP = { start: 1_000_000, end: 1_000_120, title: 'Prog', description: '', icon: '' };

// A stand-in <video> with controllable duration/currentTime — jsdom's real one
// reports duration NaN and ignores currentTime without a media source.
function fakeVideo(duration: number): HTMLVideoElement {
  let currentTime = 0;
  let src = '';
  let paused = false;
  const listeners: Record<string, Array<() => void>> = {};
  return {
    duration,
    get currentTime() { return currentTime; },
    set currentTime(t: number) { currentTime = t; },
    get paused() { return paused; },
    get src() { return src; },
    set src(v: string) { src = v; },
    classList: { add() {}, remove() {} },
    canPlayType: () => '',
    play: () => { paused = false; return Promise.resolve(); },
    pause() { paused = true; },
    load() {}, removeAttribute() {}, appendChild() {}, set innerHTML(_: string) {},
    addEventListener(type: string, fn: () => void) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(e: Event) { (listeners[e.type] || []).forEach((fn) => fn()); return true; },
  } as unknown as HTMLVideoElement;
}

// A live <video> stand-in: duration Infinity and a single seekable range (the DVR
// window), with a mutable window so tests can simulate it rolling forward.
function fakeLiveVideo(start: number, end: number, currentTime = 0) {
  let ct = currentTime;
  let paused = false;
  let src = '';
  let w = { start, end };
  const listeners: Record<string, Array<() => void>> = {};
  const video = {
    duration: Infinity,
    get currentTime() { return ct; },
    set currentTime(t: number) { ct = t; },
    get paused() { return paused; },
    get src() { return src; },
    set src(v: string) { src = v; },
    seekable: { length: 1, start: () => w.start, end: () => w.end },
    classList: { add() {}, remove() {} },
    canPlayType: () => '',
    play: () => { paused = false; return Promise.resolve(); },
    pause() { paused = true; },
    load() {}, removeAttribute() {}, appendChild() {}, set innerHTML(_: string) {},
    addEventListener(type: string, fn: () => void) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(e: Event) { (listeners[e.type] || []).forEach((fn) => fn()); return true; },
  };
  return {
    video: video as unknown as HTMLVideoElement,
    setWindow: (s: number, e: number) => { w = { start: s, end: e }; },
  };
}

let container: HTMLElement;
let player: Player;
let video: HTMLVideoElement;

// The desktop path probes the stream's Content-Type before routing; stub it so
// tests stay offline and deterministic (HLS → hls.js fallback sets video.src).
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    headers: { get: () => 'application/vnd.apple.mpegurl' },
    body: { cancel: async () => {} },
  })));
  document.body.innerHTML = '';
  container = document.createElement('div');
  const osd = document.createElement('div');
  osd.id = 'player-osd';
  container.appendChild(osd);
  document.body.appendChild(container);
  playlistMock.getByIndex.mockReturnValue(CHANNEL);
  player = new Player(container, vi.fn());
  video = fakeVideo(120);
  player.init(video);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bar = () => container.querySelector('.osd-progress-bar') as HTMLElement;
const elapsed = () => container.querySelector('.osd-time-current')!.textContent;

describe('Player catch-up seeking', () => {
  beforeEach(() => player.play(0, CATCHUP)); // catch-up → OSD shown, seekable

  it('renders a seek bar showing the playback position and total', () => {
    expect(container.querySelector('[data-seekbar]')).not.toBeNull();
    expect(elapsed()).toBe('0:00');
    expect(container.querySelector('.osd-time-end')!.textContent).toBe('2:00');
    expect(player.canSeek()).toBe(true);
  });

  it('Right seeks forward by the step, Left back; the bar + label follow', () => {
    player.handleAction('right');
    expect(video.currentTime).toBe(30);
    expect(bar().style.width).toBe('25%');
    expect(elapsed()).toBe('0:30');

    player.handleAction('right');
    expect(video.currentTime).toBe(60);
    expect(bar().style.width).toBe('50%');

    player.handleAction('left');
    expect(video.currentTime).toBe(30);
  });

  it('clamps seeks to [0, duration]', () => {
    player.handleAction('left'); // 0 - 30 → 0
    expect(video.currentTime).toBe(0);
    for (let i = 0; i < 5; i++) player.handleAction('right'); // 150 → clamp 120
    expect(video.currentTime).toBe(120);
  });

  const stubBar = () => {
    const seekbar = container.querySelector('[data-seekbar]') as HTMLElement;
    seekbar.getBoundingClientRect = () => ({ left: 0, right: 1000, width: 1000, top: 0, bottom: 36 }) as DOMRect;
  };

  it('a pointer release over the bar seeks to that fraction of the duration', () => {
    stubBar();
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 750, clientY: 18 }));
    expect(video.currentTime).toBe(90); // 0.75 * 120
  });

  it('OK while the cursor is over the bar seeks to the pointer position', () => {
    stubBar();
    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 250, clientY: 18 }));
    player.handleAction('select');
    expect(video.currentTime).toBe(30); // 0.25 * 120
  });

  it('OK away from the bar pauses playback instead of seeking', () => {
    stubBar();
    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 250, clientY: 500 })); // off the bar
    player.handleAction('select');
    expect(video.currentTime).toBe(0); // not seeked
    expect(video.paused).toBe(true); // paused instead
  });

  it('a d-pad press clears the cursor so OK pauses instead of seeking', () => {
    stubBar();
    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 250, clientY: 18 }));
    player.handleAction('right'); // d-pad seek clears the tracked cursor
    expect(video.currentTime).toBe(30);
    player.handleAction('select');
    expect(video.paused).toBe(true); // paused (cursor cleared), not seeked to the stale pointer
  });

  it('is no longer seekable once the OSD hides', () => {
    player.hideOSD();
    expect(player.canSeek()).toBe(false);
  });
});

describe('Player catch-up pause/play', () => {
  beforeEach(() => player.play(0, CATCHUP)); // catch-up → OSD shown, finite duration

  it('renders a play/pause control', () => {
    expect(container.querySelector('[data-playpause]')).not.toBeNull();
  });

  it('OK (OSD up, cursor off the bar) pauses then resumes playback', () => {
    expect(video.paused).toBe(false);
    player.handleAction('select'); // OSD up + catch-up → pause
    expect(video.paused).toBe(true);
    player.handleAction('select'); // resume
    expect(video.paused).toBe(false);
  });

  it('the pause/play remote keys toggle playback', () => {
    player.handleAction('pause');
    expect(video.paused).toBe(true);
    player.handleAction('play');
    expect(video.paused).toBe(false);
  });

  // Magic Remote OK fires mouseup with no synthesized click, so the control is
  // driven from mouseup by coordinates — mirror the live DVR play/pause test.
  it('a pointer release (Magic Remote OK) on the play/pause control pauses playback', () => {
    const btn = container.querySelector('[data-playpause]') as HTMLElement;
    btn.getBoundingClientRect = () => ({ left: 10, right: 42, width: 32, top: 0, bottom: 32 }) as DOMRect;
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 26, clientY: 16 }));
    expect(video.paused).toBe(true);
  });
});

describe('Player catch-up completion', () => {
  it('resumes the channel live stream when the catch-up programme ends', async () => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
    const v = document.createElement('video');
    Object.defineProperty(v, 'duration', { value: 120, configurable: true });
    container.appendChild(v);
    player.init(v);

    player.play(0, CATCHUP);
    await flush();
    expect(container.querySelector('video')!.src).toContain('/catchup/');
    expect(player.canSeek()).toBe(true);

    container.querySelector('video')!.dispatchEvent(new Event('ended'));
    await flush();

    expect(container.querySelector('video')!.src).toContain('/play/'); // live URL on the fresh element
    expect(player.canSeek()).toBe(false); // live, not seekable
  });
});

describe('Player live playback', () => {
  it('has no seek bar and is not seekable', () => {
    player.play(0); // live, no catch-up
    expect(player.canSeek()).toBe(false);
    expect(container.querySelector('[data-seekbar]')).toBeNull();
  });
});

describe('Player live DVR', () => {
  let live: HTMLVideoElement;
  let setWindow: (s: number, e: number) => void;
  const PAD = CONFIG.PLAYER.DVR_GO_LIVE_PAD;

  beforeEach(() => {
    ({ video: live, setWindow } = fakeLiveVideo(0, 60, 60)); // 60s window, at the live edge
    player.init(live);
    player.play(0); // live, no catch-up → OSD shown
  });

  it('is seekable within the window and shows a seek bar', () => {
    expect(player.canSeek()).toBe(true);
    expect(container.querySelector('[data-seekbar]')).not.toBeNull();
  });

  it('Left rewinds by the step, moving the bar', () => {
    player.handleAction('left'); // 60 - 30 = 30
    expect(live.currentTime).toBe(30);
    expect((container.querySelector('.osd-progress-bar') as HTMLElement).style.width).toBe('50%');
  });

  it('Right near the live edge snaps to the edge (end - pad)', () => {
    player.handleAction('right'); // 60 + 30 → clamp 60 → snap 60 - PAD
    expect(live.currentTime).toBe(60 - PAD);
  });

  it('rewind jumps to the oldest point, fast_forward to live', () => {
    player.handleAction('rewind');
    expect(live.currentTime).toBe(0);
    player.handleAction('fast_forward');
    expect(live.currentTime).toBe(60 - PAD);
  });

  it('pause/play and OK toggle playback', () => {
    player.handleAction('pause');
    expect(live.paused).toBe(true);
    player.handleAction('play');
    expect(live.paused).toBe(false);
    player.handleAction('select'); // OSD up + live DVR → pause
    expect(live.paused).toBe(true);
  });

  it('clamps to the window start when resuming after it rolled past the paused point', () => {
    player.handleAction('rewind'); // to 0
    player.handleAction('pause');
    setWindow(20, 80); // window rolled forward while paused
    player.handleAction('play');
    expect(live.currentTime).toBe(20);
  });

  // The Magic Remote OK fires mouseup (and pointer events) but NOT a synthesized
  // click, and its target can be the video plane — so the OSD controls must be
  // driven from mouseup by coordinates, like the seek bar.
  it('a pointer release (Magic Remote OK) on the pause control pauses playback', () => {
    const btn = container.querySelector('[data-playpause]') as HTMLElement;
    btn.getBoundingClientRect = () => ({ left: 10, right: 42, width: 32, top: 0, bottom: 32 }) as DOMRect;
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 26, clientY: 16 }));
    expect(live.paused).toBe(true);
  });

  it('a pointer release on the Go-to-Live control seeks to the live edge', () => {
    player.handleAction('rewind'); // move to the oldest point (0)
    expect(live.currentTime).toBe(0);
    const btn = container.querySelector('[data-golive]') as HTMLElement;
    btn.getBoundingClientRect = () => ({ left: 500, right: 560, width: 60, top: 0, bottom: 32 }) as DOMRect;
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 530, clientY: 16 }));
    expect(live.currentTime).toBe(60 - PAD);
  });

  it('reveals the DVR bar once the window becomes available, without reopening the OSD', () => {
    // Tune in to a live stream whose seekable window is not usable yet.
    const { video: v2, setWindow } = fakeLiveVideo(0, 3, 0); // 3s < DVR_MIN_WINDOW
    player.init(v2);
    player.play(0); // OSD shown, but no DVR window yet
    expect(container.querySelector('[data-seekbar]')).toBeNull();

    // The pipeline fills the retained window; the next timeupdate must switch the
    // OSD to the DVR layout on its own (no close/reopen).
    setWindow(0, 60);
    v2.dispatchEvent(new Event('timeupdate'));

    expect(container.querySelector('[data-seekbar]')).not.toBeNull();
    expect(container.querySelector('[data-playpause]')).not.toBeNull();
  });
});

describe('Player OSD image handling', () => {
  // renderOSD re-runs on pointer move (to keep the OSD fresh); it must reuse the
  // programme <img> instead of recreating it, and drop one that failed to load so
  // a broken image can't thrash the layout.
  it('reuses the programme icon element across re-renders instead of recreating it', () => {
    player.play(0, { ...CATCHUP, icon: 'http://host/a.jpg' });
    const img1 = container.querySelector('.osd-programme-icon');
    expect(img1).not.toBeNull();
    player.showOSD(); // a re-render (e.g. pointer moved into the OSD area)
    expect(container.querySelector('.osd-programme-icon')).toBe(img1); // same node → no reload
  });

  it('drops a programme icon that failed to load and does not re-request it', () => {
    player.play(0, { ...CATCHUP, icon: 'http://host/broken.jpg' });
    const img = container.querySelector('.osd-programme-icon') as HTMLImageElement;
    expect(img).not.toBeNull();
    img.dispatchEvent(new Event('error'));
    expect(container.querySelector('.osd-programme-icon')).toBeNull(); // dropped on error
    player.showOSD(); // re-render must not bring it back
    expect(container.querySelector('.osd-programme-icon')).toBeNull();
  });

  it('retries a previously-failed icon on the next channel/programme (failure is per-visit)', () => {
    player.play(0, { ...CATCHUP, icon: 'http://host/x.jpg' });
    (container.querySelector('.osd-programme-icon') as HTMLImageElement).dispatchEvent(new Event('error'));
    expect(container.querySelector('.osd-programme-icon')).toBeNull();

    player.play(1, { ...CATCHUP, icon: 'http://host/x.jpg' }); // switch channel, same icon URL
    expect(container.querySelector('.osd-programme-icon')).not.toBeNull(); // fresh attempt
  });
});

describe('Player stall reconnect OSD', () => {
  it('clears the Reconnecting… message after the reloaded stream recovers', async () => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
    const v = document.createElement('video');
    container.appendChild(v);
    player.init(v);

    player.play(0); // live
    await flush();

    // A real stall reloads only after the OSD has auto-hidden (osdVisible false)
    // — the case the message used to get stuck in.
    vi.advanceTimersByTime(CONFIG.PLAYER.OSD_TIMEOUT + 100);

    (player as unknown as { reloadCurrentStream(): void }).reloadCurrentStream();
    await flush();
    const osd = container.querySelector('#player-osd')!;
    expect(osd.textContent).toContain('Reconnecting');

    // Recovery (loadedmetadata) must repaint over the message, not leave it stuck.
    container.querySelector('video')!.dispatchEvent(new Event('loadedmetadata'));
    expect(osd.textContent).not.toContain('Reconnecting');
  });
});

describe('Player audio track picker', () => {
  // Native path with a collapsed manifest: 3 declared renditions but the TV
  // exposes only 2 tracks (two share a language). The manifest non-conformantly
  // tags two renditions DEFAULT=YES; the picker must still check exactly one row
  // — the track actually enabled — not every manifest default.
  it('checks only the playing track, not every manifest DEFAULT', () => {
    (player as unknown as { hls: unknown }).hls = null;
    (player as unknown as { videoEl: unknown }).videoEl = {
      audioTracks: {
        length: 2,
        0: { label: '', language: 'l1', enabled: true },
        1: { label: '', language: 'l2', enabled: false },
      },
    };
    (player as unknown as { manifestAudio: unknown }).manifestAudio = [
      { name: 'Track 1', lang: 'l1', isDefault: true },
      { name: 'Track 2', lang: 'l2', isDefault: true },
      { name: 'Track 3', lang: 'l1', isDefault: false },
    ];

    const tracks = player.getAudioTracks();
    expect(tracks.map((t) => t.active)).toEqual([true, false, false]);
    expect(tracks[2].available).toBe(false); // collapsed alternate grayed out
  });
});

describe('Player subtitle self-render (webOS native path)', () => {
  // In-manifest WebVTT is self-rendered on the native path. Inject a fake
  // controller so we can assert what gets rendered without real fetches, and
  // drive the native branch by clearing `hls`.
  let subs: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; active: boolean };

  const rendition = (name: string, lang: string, over: { isDefault?: boolean; isForced?: boolean } = {}) =>
    ({ name, lang, isDefault: !!over.isDefault, isForced: !!over.isForced });

  const setup = (manifestSubtitles: unknown[], selfRenderIndex = -1) => {
    subs = { start: vi.fn(), stop: vi.fn(), active: false };
    const p = player as unknown as Record<string, unknown>;
    p.hls = null;
    p.videoEl = { textTracks: { length: 0 } };
    p.subs = subs;
    p.manifestSubtitles = manifestSubtitles;
    p.masterUrl = 'http://host/master.m3u8';
    p.selfRenderIndex = selfRenderIndex;
    p.currentChannel = CHANNEL;
  };
  const applySelfRender = () =>
    (player as unknown as { applySelfRenderSelection(): void }).applySelfRenderSelection();

  beforeEach(() => vi.mocked(StorageService.getSubtitlePref).mockReset());

  it('does not self-render a DEFAULT-only rendition on tune-in (off unless forced)', () => {
    setup([rendition('Track 1', 'l1', { isDefault: true })]);
    vi.mocked(StorageService.getSubtitlePref).mockReturnValue(null);
    applySelfRender();
    expect(subs.start).not.toHaveBeenCalled();
  });

  it('auto-self-renders a FORCED rendition on tune-in', () => {
    setup([rendition('Track 1', 'l1', { isDefault: true }), rendition('Track 2', 'l2', { isForced: true })]);
    vi.mocked(StorageService.getSubtitlePref).mockReturnValue(null);
    applySelfRender();
    expect(subs.start).toHaveBeenCalledWith(expect.anything(), 'http://host/master.m3u8', { name: 'Track 2', lang: 'l2' });
  });

  it('re-applies a saved subtitle pick on tune-in', () => {
    setup([rendition('Track 1', 'l1'), rendition('Track 2', 'l2')]);
    vi.mocked(StorageService.getSubtitlePref).mockReturnValue({ off: false, name: 'Track 2', lang: 'l2' });
    applySelfRender();
    expect(subs.start).toHaveBeenCalledWith(expect.anything(), expect.any(String), { name: 'Track 2', lang: 'l2' });
  });

  it('stays off when the saved pref is an explicit off (survives re-tune)', () => {
    setup([rendition('Track 1', 'l1', { isDefault: true })]);
    vi.mocked(StorageService.getSubtitlePref).mockReturnValue({ off: true, name: '', lang: '' });
    applySelfRender();
    expect(subs.start).not.toHaveBeenCalled();
  });

  it('selecting a subtitle self-renders it and remembers the pick', () => {
    setup([rendition('Track 1', 'l1'), rendition('Track 2', 'l2')]);
    player.selectSubtitleTrack(1);
    expect(subs.start).toHaveBeenCalledWith(expect.anything(), 'http://host/master.m3u8', { name: 'Track 2', lang: 'l2' });
    expect(StorageService.setSubtitlePref).toHaveBeenCalledWith(expect.any(String), { off: false, name: 'Track 2', lang: 'l2' });
  });

  it('selecting Off stops self-render and remembers off', () => {
    setup([rendition('Track 1', 'l1')], 0);
    player.selectSubtitleTrack(-1);
    expect(subs.stop).toHaveBeenCalled();
    expect(StorageService.setSubtitlePref).toHaveBeenCalledWith(expect.any(String), { off: true, name: '', lang: '' });
  });

  it('lists the manifest renditions with the self-rendered one active and all selectable', () => {
    setup([rendition('Track 1', 'l1'), rendition('Track 2', 'l2')], 1);
    const tracks = player.getSubtitleTracks();
    expect(tracks.map((t) => t.label)).toEqual(['Track 1', 'Track 2']);
    expect(tracks.map((t) => t.active)).toEqual([false, true]);
    expect(tracks.every((t) => t.available)).toBe(true);
  });
});
