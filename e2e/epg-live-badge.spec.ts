import { test, expect, type Page } from '@playwright/test';

// Fixed "now" placed inside the middle programme so exactly one row is airing.
// UTC device + +0000 EPG keeps wall-clock == absolute time, so the live/past/
// future split is unambiguous regardless of timezone mode.
test.use({ timezoneId: 'UTC' });
const NOW = new Date('2024-03-09T12:00:00Z');

const M3U = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="ch1" group-title="News",Channel 1',
  'http://streams.example.com/ch1.m3u8',
].join('\n');

// Three programmes on 03/09: one already ended, one airing at NOW (12:00Z), one
// yet to start. Only the middle one is "live" and must show the pulsing badge.
const EPG = `<?xml version="1.0" encoding="UTF-8"?><tv>
<channel id="ch1"><display-name>Channel 1</display-name></channel>
<programme channel="ch1" start="20240309100000 +0000" stop="20240309110000 +0000"><title>Earlier Show</title></programme>
<programme channel="ch1" start="20240309110000 +0000" stop="20240309130000 +0000"><title>Live Show</title></programme>
<programme channel="ch1" start="20240309130000 +0000" stop="20240309140000 +0000"><title>Later Show</title></programme>
</tv>`;

async function setup(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:8890/**', r => r.abort());
  await page.route('**/playlist.m3u', r => r.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: M3U }));
  await page.route('**/epg.xml', r => r.fulfill({ status: 200, contentType: 'application/xml', body: EPG }));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{ name: 'P', url: 'http://host/playlist.m3u' }]));
    localStorage.setItem('iptv_epg_url', JSON.stringify('http://host/epg.xml'));
    localStorage.setItem('iptv_tz_mode', JSON.stringify('device'));
  });
}

test('the EPG marks the currently-airing programme with a pulsing LIVE badge', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  // Open the guide (Red / Programme Guide remote key).
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 403, bubbles: true })));
  await expect(page.locator('#view-epg')).toBeVisible();
  await page.locator('#epg-programmes .epg-programme-item').first().waitFor();

  // Exactly one programme is live — the 11:00–13:00 show — and it carries the badge.
  const live = page.locator('#epg-programmes .epg-programme-item.state-live');
  await expect(live).toHaveCount(1);
  await expect(live).toContainText('Live Show');

  const badge = live.locator('.epg-now-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveText(/LIVE/);

  // The dot doesn't just exist — it carries the looping pulse animation...
  const dot = badge.locator('.epg-now-dot');
  await expect(dot).toHaveCount(1);
  await expect(dot).toHaveCSS('animation-name', 'epgDotPulse');
  await expect(dot).toHaveCSS('animation-iteration-count', 'infinite');

  // ...and it's a real animation, not a no-op: a computed style (or empty/paused
  // keyframes) can't tell "looping" from "frozen". The test's fixed clock freezes
  // the timeline so we can't sample motion, but the Web Animations API proves it
  // is RUNNING and its keyframes genuinely VARY the opacity — i.e. it really pulses.
  const anim = await dot.evaluate((el) => {
    const a = el.getAnimations()[0];
    const opacities = (a.effect as KeyframeEffect).getKeyframes().map((k) => k.opacity);
    return { playState: a.playState, distinctOpacities: new Set(opacities).size };
  });
  expect(anim.playState).toBe('running');     // active, not paused/idle/finished
  expect(anim.distinctOpacities).toBeGreaterThan(1); // opacity changes across the cycle → it pulses

  // Only the airing row gets a badge; the ended row is "past" and unbadged.
  await expect(page.locator('#epg-programmes .epg-now-badge')).toHaveCount(1);
  const earlier = page.locator('#epg-programmes .epg-programme-item', { hasText: 'Earlier Show' });
  await expect(earlier).toHaveClass(/state-past/);
  await expect(earlier.locator('.epg-now-badge')).toHaveCount(0);
});

test('with reduced motion the LIVE badge still shows, but the pulse is disabled', async ({ page }) => {
  // epg.css has `@media (prefers-reduced-motion: reduce) { .epg-now-dot { animation: none } }`.
  // Modern engines honour it (webOS 5 / Chromium 68 ignores it and keeps pulsing —
  // both acceptable). Verify the off-switch on an engine that honours it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 403, bubbles: true })));
  await expect(page.locator('#view-epg')).toBeVisible();
  await page.locator('#epg-programmes .epg-programme-item.state-live').first().waitFor();

  // Accessibility: the badge/dot still render (the LIVE indicator stays)...
  const dot = page.locator('#epg-programmes .epg-programme-item.state-live .epg-now-dot');
  await expect(dot).toHaveCount(1);
  // ...but the pulse is turned off entirely — no animation name, no running animation.
  await expect(dot).toHaveCSS('animation-name', 'none');
  expect(await dot.evaluate((el) => el.getAnimations().length)).toBe(0);
});
