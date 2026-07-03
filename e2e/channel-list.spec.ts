import { test, expect, routePlaylist, seedPlaylist, SEARCH_M3U } from './helpers';

// The channel list: rendering safety (XSS) and search.

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

test('channel list search filters by name and clears', async ({ page }) => {
  await routePlaylist(page, SEARCH_M3U);
  await seedPlaylist(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(page.locator('.channel-main .channel-item')).toHaveCount(4);

  await page.locator('.channel-search-input').fill('alpha');
  await expect(page.locator('.channel-main .channel-item')).toHaveCount(2);
  await expect(page.locator('.channel-main')).toContainText('Alpha News');
  await expect(page.locator('.channel-main')).toContainText('Alpha Movies');
  await expect(page.locator('.channel-main')).not.toContainText('Beta News');

  await page.locator('.channel-search-input').fill('');
  await expect(page.locator('.channel-main .channel-item')).toHaveCount(4);
});

test('channel list search spans groups, ignoring the selected group', async ({ page }) => {
  await routePlaylist(page, SEARCH_M3U);
  await seedPlaylist(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  // Narrow to the News group, then search a Sports channel — it still appears.
  await page.locator('[data-group="News"]').click();
  await expect(page.locator('.channel-main .channel-item')).toHaveCount(2);

  await page.locator('.channel-search-input').fill('delta');
  await expect(page.locator('.channel-main .channel-item')).toHaveCount(1);
  await expect(page.locator('.channel-main')).toContainText('Delta Sports');
});

test('the channel list highlights the search box on entry; caret only on OK', async ({ page }) => {
  await routePlaylist(page, SEARCH_M3U);
  await seedPlaylist(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  const search = page.locator('.channel-search-input');
  // Highlighted, but no caret/keyboard until OK.
  await expect(search).toHaveClass(/focused/);
  await expect(search).not.toBeFocused();

  // Re-entering from settings highlights it again, still without the caret.
  await page.locator('.settings-btn').click();
  await expect(page.locator('#view-settings')).toBeVisible();
  await page.locator('#cancel-settings').click();
  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(search).toHaveClass(/focused/);
  await expect(search).not.toBeFocused();

  // OK grabs the caret.
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
});
