import { test, expect, type Page } from '@playwright/test';

// Boot into the channel list (so the settings gear is present) with one M3U
// playlist and NO Xtream account — matching "no Xtream account at all".
async function seedOneM3u(page: Page): Promise<void> {
  await page.route('**/one.m3u', r => r.fulfill({
    status: 200, contentType: 'application/x-mpegurl',
    body: '#EXTM3U\n#EXTINF:-1,Alpha\nhttp://streams.example.com/a',
  }));
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { name: 'Playlist 1', url: 'http://host.example.com/one.m3u', source: 'url', id: 'id1' },
    ]));
  });
}

async function openSettings(page: Page): Promise<void> {
  await page.waitForSelector('.settings-btn', { timeout: 20000 });
  await page.click('.settings-btn');
  await page.waitForSelector('#add-xtream');
}

test.describe('Xtream: add -> cancel -> re-enter', () => {
  test("re-entering Settings after Cancel must NOT show a leftover Xtream card", async ({ page }) => {
    await seedOneM3u(page);
    await page.goto('/');

    // 1) Open Settings — no Xtream account yet, no auto-added card.
    await openSettings(page);
    await expect(page.locator('#xtream-entries .xtream-card')).toHaveCount(0);
    await expect(page.locator('#xtream-entries .empty-hint')).toHaveText('No Xtream accounts added yet');

    // 2) Click "+ Add Xtream Account" — a blank card appears.
    await page.click('#add-xtream');
    await expect(page.locator('#xtream-entries .xtream-card')).toHaveCount(1);

    // 3) Cancel.
    await page.click('#cancel-settings');
    await page.waitForSelector('.settings-btn'); // back on channels

    // 4) Re-enter Settings.
    await openSettings(page);

    // 5) The card must be gone (this is the user's reported bug).
    await expect(page.locator('#xtream-entries .xtream-card')).toHaveCount(0);
    await expect(page.locator('#xtream-entries .empty-hint')).toHaveText('No Xtream accounts added yet');
  });
});
