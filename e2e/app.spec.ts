import { test, expect } from '@playwright/test';

const SAMPLE_M3U = [
  '#EXTM3U url-tvg="http://epg.example.com/guide.xml"',
  '#EXTINF:-1 tvg-id="one" group-title="News",Channel One',
  'http://streams.example.com/one.m3u8',
  '#EXTINF:-1 tvg-id="two" group-title="Movies",Channel Two',
  'http://streams.example.com/two.m3u8',
].join('\n');

test('opens settings on first run when no playlist is configured', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#view-settings')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('playlist');
});

test('loads and renders channels from a configured playlist', async ({ page }) => {
  await page.route('**/playlist.m3u', route =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      'iptv_playlists',
      JSON.stringify([{ name: 'Test', url: 'http://host.example.com/playlist.m3u' }]),
    );
  });

  await page.goto('/');

  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(page.getByText('Channel One')).toBeVisible();
  await expect(page.getByText('Channel Two')).toBeVisible();
});

test('gear button on the channel list opens settings', async ({ page }) => {
  await page.route('**/playlist.m3u', route =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      'iptv_playlists',
      JSON.stringify([{ name: 'Test', url: 'http://host.example.com/playlist.m3u' }]),
    );
  });

  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  await page.locator('.settings-btn').click();

  await expect(page.locator('#view-settings')).toBeVisible();
  // The configured playlist URL is populated in the settings form.
  await expect(page.locator('.playlist-url').first()).toHaveValue(
    'http://host.example.com/playlist.m3u',
  );
});
