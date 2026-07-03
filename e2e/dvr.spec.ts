import { test, expect, type Page } from '@playwright/test';

// Live DVR pointer control (regression guard for the on-device bug where the
// Magic Remote OK — a bare mouseup, no synthesized click — over the pause/Go-to-Live
// controls did nothing because they were wired to `click`).

const PLAYLIST_URL = 'http://host.example.com/playlist.m3u';
const M3U = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="News",Channel One',
  'http://streams.example.com/one.m3u8',
].join('\n');

async function setup(page: Page): Promise<void> {
  // The bundled upload service isn't running in the preview; abort its probes fast.
  await page.route('http://127.0.0.1:8890/**', (route) => route.abort());
  await page.route('**/playlist.m3u', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: M3U }));
  // A minimal live HLS body so the content-type probe routes to the video path.
  await page.route('**/*.m3u8', (route) => route.fulfill({
    status: 200,
    contentType: 'application/vnd.apple.mpegurl',
    body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n',
  }));
  await page.addInitScript((url) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{ name: 'Test', url }]));
  }, PLAYLIST_URL);
}

/**
 * Real live playback with a DVR window can't be relied on in headless Chromium,
 * so turn the actual <video> into a controllable live-DVR stand-in in the page
 * (Infinity duration + a seekable window + a paused flag), then re-render the OSD
 * so its DVR bar and controls appear. The real player code drives everything.
 */
async function fakeLiveDvrOsd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const v = document.getElementById('video-player') as HTMLVideoElement;
    let paused = false;
    let ct = 0;
    Object.defineProperty(v, 'duration', { configurable: true, get: () => Infinity });
    Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (t: number) => { ct = t; } });
    Object.defineProperty(v, 'seekable', {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => 60 }),
    });
    Object.defineProperty(v, 'paused', { configurable: true, get: () => paused });
    (v as unknown as { play: () => Promise<void> }).play = () => { paused = false; return Promise.resolve(); };
    (v as unknown as { pause: () => void }).pause = () => { paused = true; };
    // Yellow (Channel Info) re-shows/re-renders the OSD; the DVR bar now appears.
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 405, bubbles: true }));
  });
}

/** Fire the Magic Remote OK on a control — a bare mouseup (no click) at its center
 *  — and read the video state back in the SAME synchronous browser task, so the
 *  fake stream's retry churn (which calls video.play()) can't intervene between
 *  the action and the assertion. Re-shows the OSD first (it auto-hides). */
async function okAndReadVideo(page: Page, selector: string): Promise<{ paused: boolean; currentTime: number }> {
  return page.evaluate((sel) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 405, bubbles: true })); // yellow → showOSD (sync render)
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no control ${sel}`);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }));
    const v = document.getElementById('video-player') as HTMLVideoElement;
    return { paused: v.paused, currentTime: v.currentTime };
  }, selector);
}

async function gotoPlayer(page: Page): Promise<void> {
  await setup(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-player')).toBeVisible();
  await fakeLiveDvrOsd(page);
}

test('pause control pauses on a Magic-Remote pointer release (mouseup, no click)', async ({ page }) => {
  await gotoPlayer(page);
  await expect(page.locator('[data-playpause]')).toBeVisible();

  const state = await okAndReadVideo(page, '[data-playpause]');

  expect(state.paused).toBe(true);
});

test('Go-to-Live control seeks to the live edge on a pointer release', async ({ page }) => {
  await gotoPlayer(page);
  // Rewind to the oldest point, then jump to live by pointer; read seek back in the
  // same task that dispatches it (seekable.end 60 minus the go-live pad 3 = 57).
  const rewound = await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 412, bubbles: true }));
    return (document.getElementById('video-player') as HTMLVideoElement).currentTime;
  });
  expect(rewound).toBe(0);

  const state = await okAndReadVideo(page, '[data-golive]');

  expect(state.currentTime).toBe(57);
});
