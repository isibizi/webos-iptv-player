import { test, expect, type Page } from '@playwright/test';

const SAMPLE_M3U = [
  '#EXTM3U url-tvg="http://epg.example.com/guide.xml"',
  '#EXTINF:-1 tvg-id="one" group-title="News",Channel One',
  'http://streams.example.com/one.m3u8',
  '#EXTINF:-1 tvg-id="two" group-title="Movies",Channel Two',
  'http://streams.example.com/two.m3u8',
].join('\n');

const PLAYLIST_URL = 'http://host.example.com/playlist.m3u';

/** Serve the given M3U body for the playlist URL the tests configure. */
async function routePlaylist(page: Page, body = SAMPLE_M3U): Promise<void> {
  await page.route('**/playlist.m3u', route =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body }),
  );
}

/** Pre-seed a configured playlist so the app boots straight into the channel list. */
async function seedPlaylist(page: Page): Promise<void> {
  await page.addInitScript((url) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{ name: 'Test', url }]));
  }, PLAYLIST_URL);
}

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

test('remote arrow keys move focus and Enter starts playback', async ({ page }) => {
  await routePlaylist(page);
  await seedPlaylist(page);
  await page.goto('/');

  await expect(page.locator('#view-channels')).toBeVisible();

  // Initial focus lands on the first channel in the channel list.
  const focused = page.locator('.channel-main .channel-item.focused');
  await expect(focused).toHaveCount(1);
  await expect(focused).toContainText('Channel One');

  // Arrow Down moves focus to the next channel, Arrow Up moves it back.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.channel-main .channel-item.focused')).toContainText('Channel Two');

  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.channel-main .channel-item.focused')).toContainText('Channel One');

  // Enter on the focused channel starts playback (switches to the player view).
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-player')).toBeVisible();
});

test('a malicious channel name from the playlist is escaped, not executed', async ({ page }) => {
  const EVIL = '<img src=x onerror="window.__xssfired=true">';
  const evilM3u = [
    '#EXTM3U',
    `#EXTINF:-1 tvg-id="evil" group-title="News",${EVIL}`,
    'http://streams.example.com/evil.m3u8',
  ].join('\n');

  await routePlaylist(page, evilM3u);
  await seedPlaylist(page);
  await page.goto('/');

  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(page.locator('.channel-main .channel-item')).toHaveCount(1);

  // The name is rendered as literal text, escaped...
  await expect(page.locator('.channel-main .channel-name')).toContainText('<img src=x onerror=');
  // ...so no injected <img> element exists and its onerror never fired.
  await expect(page.locator('.channel-main img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xssfired?: boolean }).__xssfired)).toBeUndefined();
});

test('saving a playlist in settings reloads and shows its channels', async ({ page }) => {
  await routePlaylist(page);
  await page.goto('/');

  // First run with no playlist opens settings.
  await expect(page.locator('#view-settings')).toBeVisible();

  // Add a playlist row and fill in its URL.
  await page.locator('#add-playlist').click();
  await page.locator('.playlist-name').first().fill('Saved');
  await page.locator('.playlist-url').first().fill(PLAYLIST_URL);

  // Drive Save via the remote-style focus + Enter path (avoids the click's
  // deferred select firing on the channel view after the reload).
  await page.locator('.playlist-url').first().blur();
  await page.locator('#save-settings').dispatchEvent('nav:hover');
  await page.keyboard.press('Enter');

  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(page.getByText('Channel One')).toBeVisible();
  await expect(page.getByText('Channel Two')).toBeVisible();
});
