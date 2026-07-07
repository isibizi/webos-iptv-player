import { test, expect, routeLiveManifest, SAMPLE_M3U, enterTab } from './helpers';

// Seed one Xtream account (enables the tab bar) and stub the player_api.php
// series calls + the get.php/xmltv.php the live path uses.
async function seedSeries(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/get.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U }));
  await page.route('**/xmltv.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: '<tv></tv>' }));
  await page.route('**/player_api.php*', (route) => {
    const url = route.request().url();
    if (url.includes('get_series_categories')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ category_id: '1', category_name: 'Cat A' }]) });
    }
    if (url.includes('get_series_info')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        episodes: { '1': [
          { id: 10, title: 'Episode One', season: 1, episode_num: 1, container_extension: 'mp4', info: { plot: 'Ep plot.', duration_secs: 1500, movie_image: '' } },
        ] },
      }) });
    }
    if (url.includes('get_series')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { series_id: 1, name: 'Series One', cover: '', category_id: '1' },
      ]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // The episode file itself: a small response so play() doesn't hang the test.
  await page.route('**/series/**', (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'x1', name: 'X Account', url: 'http://host.example.com:8080',
        source: 'xtream', xtream: { username: 'u', password: 'p' } },
    ]));
  });
}

test('browse Series, open a detail, and play an episode', async ({ page }) => {
  await seedSeries(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  // Enter Series via the docked tab bar.
  await enterTab(page, 'series');
  await expect(page.locator('#view-series')).toBeVisible();

  await expect(page.locator('#view-series .catalog-rail-title')).toContainText('Cat A');
  await expect(page.locator('.catalog-tile[data-item-id="1"]')).toContainText('Series One');

  // Open the series detail. Dispatch an explicit bubbling nav:hover so
  // SpatialNav's container-bound listener focuses the tile before OK.
  await page.locator('.catalog-tile[data-item-id="1"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-series .series-season-btn[data-season="1"]')).toContainText('Season 1');
  await expect(page.locator('#view-series .episode-row[data-episode-id="10"]')).toContainText('Episode One');

  // Play the episode, then Back returns to the Series view.
  await page.locator('.episode-row[data-episode-id="10"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-player')).toBeVisible();
  // Back key (CONFIG.KEYS.BACK = 461; Backspace is unmapped); dispatch a raw
  // keydown like the other specs do.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(page.locator('#view-series')).toBeVisible();
  // The detail survives the player round-trip (Series isn't re-rendered on return).
  await expect(page.locator('#view-series .episode-row[data-episode-id="10"]')).toContainText('Episode One');
});

test('Back walks Series detail -> browse -> Live instead of ejecting', async ({ page }) => {
  await seedSeries(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  // Enter Series via the docked tab bar.
  await enterTab(page, 'series');
  await expect(page.locator('#view-series')).toBeVisible();

  await expect(page.locator('.catalog-tile[data-item-id="1"]')).toContainText('Series One');

  // Open the series detail.
  await page.locator('.catalog-tile[data-item-id="1"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-series .series-season-btn[data-season="1"]')).toContainText('Season 1');

  // First Back steps detail -> browse: still inside Series, not ejected to Live.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(page.locator('#view-series')).toBeVisible();
  await expect(page.locator('#view-series .catalog-rail-title')).toContainText('Cat A');
  await expect(page.locator('#view-channels')).toBeHidden();

  // Second Back from the browse top level returns to Live.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(page.locator('#view-channels')).toBeVisible();
});
