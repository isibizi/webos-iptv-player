import { test, expect, type Page } from '@playwright/test';

// Seed three playlists and stub their URLs so the app boots into the channel
// list without real network.
async function seedThree(page: Page): Promise<void> {
  const stream = '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:-1,\nhttp://streams.example.com/s.ts';
  await page.route('**/one.m3u8', r => r.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: stream }));
  await page.route('**/two.m3u8', r => r.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: stream }));
  await page.route('**/four.m3u', r => r.fulfill({ status: 200, contentType: 'application/x-mpegurl',
    body: '#EXTM3U\n#EXTINF:-1,Alpha\nhttp://streams.example.com/a\n#EXTINF:-1,Bravo\nhttp://streams.example.com/b' }));
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { name: 'Playlist 1', url: 'http://host.example.com/one.m3u8', source: 'url', id: 'id1' },
      { name: 'Playlist 2', url: 'http://host.example.com/two.m3u8', source: 'url', id: 'id2' },
      { name: 'Playlist 4', url: 'http://host.example.com/four.m3u', source: 'url', id: 'id3' },
    ]));
  });
}

async function openSettings(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('.settings-btn', { timeout: 20000 });
  await page.click('.settings-btn');
  await page.waitForSelector('.remove-playlist');
}

const names = (page: Page) =>
  page.$$eval('.playlist-name', els => (els as HTMLInputElement[]).map(e => e.value));

test.describe('Settings playlist removal', () => {
  // Regression: a global document click handler fired a deferred "select" after
  // the clicked Remove button detached (its `.settings-view` ancestor gone, so
  // the guard missed it), deleting a second row — clicking Remove on row N wiped
  // out N and N+1. waitForTimeout lets that deferred select fire.
  test('Remove deletes only the clicked row', async ({ page }) => {
    await seedThree(page);
    await openSettings(page);
    await page.locator('.remove-playlist').first().click();
    await page.waitForTimeout(200);
    expect(await names(page)).toEqual(['Playlist 2', 'Playlist 4']);
  });

  test('removing a middle row leaves the rest intact', async ({ page }) => {
    await seedThree(page);
    await openSettings(page);
    await page.locator('.remove-playlist').nth(1).click();
    await page.waitForTimeout(200);
    expect(await names(page)).toEqual(['Playlist 1', 'Playlist 4']);
  });

  test('deleting down to the last row clears it (no spurious re-add)', async ({ page }) => {
    // Removing the last row left focus on "+ Add Playlist"; the deferred select
    // then "clicked" it and re-added an empty row, so the last one never went.
    await seedThree(page);
    await openSettings(page);
    for (let i = 0; i < 3; i++) {
      await page.locator('.remove-playlist').first().click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.playlist-name')).toHaveCount(0);
    await expect(page.locator('#playlist-entries .empty-hint')).toBeVisible();
  });
});
