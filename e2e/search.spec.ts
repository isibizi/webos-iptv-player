import { test, expect, routeLiveManifest, SAMPLE_M3U, enterTab } from './helpers';

// Seed one Xtream account (enables the tab bar) and stub the player_api.php
// catalog calls + the get.php/xmltv.php the live path uses. get_vod_streams /
// get_series with no category return the whole catalog Search matches against;
// get_vod_info backs the movie deep-link into the Movies detail. Action names
// that are substrings of others are routed most-specific-first (get_series_*
// before get_series, get_vod_info/get_vod_categories before get_vod_streams).
async function seedSearch(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/get.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U }));
  await page.route('**/xmltv.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: '<tv></tv>' }));
  await page.route('**/player_api.php*', (route) => {
    const url = route.request().url();
    if (url.includes('get_vod_categories')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ category_id: '1', category_name: 'Cat A' }]) });
    }
    if (url.includes('get_vod_info')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ info: { plot: 'Movie plot.', duration_secs: 3600, movie_image: '' } }) });
    }
    if (url.includes('get_vod_streams')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { stream_id: 10, name: 'Movie One', stream_icon: '', container_extension: 'mp4', category_id: '1' },
      ]) });
    }
    if (url.includes('get_series_categories')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ category_id: '1', category_name: 'Cat A' }]) });
    }
    if (url.includes('get_series_info')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ episodes: {} }) });
    }
    if (url.includes('get_series')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { series_id: 1, name: 'Series One', cover: '', category_id: '1' },
      ]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // The movie file itself: a small response so play() doesn't hang the test.
  await page.route('**/movie/**', (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'x1', name: 'X Account', url: 'http://host.example.com:8080',
        source: 'xtream', xtream: { username: 'u', password: 'p' } },
    ]));
  });
}

// Open the tab bar's search box (results appear once a query is typed).
async function enterSearch(page: import('@playwright/test').Page): Promise<void> {
  await enterTab(page, 'search');
  await expect(page.locator('.tab-bar-search.expanded')).toBeVisible();
}

test('unified search matches channels, movies, and series; a channel result plays', async ({ page }) => {
  await seedSearch(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  // One query matches "Channel One" (live, from SAMPLE_M3U), "Movie One", and
  // "Series One". The catalogs load asynchronously on open, so the movie/series
  // groups appear once loaded; the assertions retry until then.
  await page.locator('.tab-bar-search-input').fill('one');
  await expect(page.locator('#view-search .catalog-tile[data-channel-index="0"]')).toContainText('Channel One');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');
  await expect(page.locator('#view-search .catalog-tile[data-series-id="1"]')).toContainText('Series One');

  // Hand off from the tab-bar box to the results (Down), then focus the channel
  // tile via a bubbling nav:hover before OK.
  await page.locator('.tab-bar-search-input').press('ArrowDown');
  await page.locator('#view-search .catalog-tile[data-channel-index="0"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-player')).toBeVisible();
});

test('a movie search result deep-links into its Movies detail and Back returns to Search', async ({ page }) => {
  await seedSearch(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  await page.locator('.tab-bar-search-input').fill('one');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');

  // Hand off to the results (Down), then open the movie result (deep-links into
  // the Movies detail).
  await page.locator('.tab-bar-search-input').press('ArrowDown');
  await page.locator('#view-search .catalog-tile[data-stream-id="10"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies')).toBeVisible();
  await expect(page.locator('#view-movies .detail-plot')).toContainText('Movie plot.');

  // Back from the deep-linked detail returns to Search (CONFIG.KEYS.BACK = 461;
  // dispatch a raw keydown like the other section specs do).
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(page.locator('#view-search')).toBeVisible();
});
