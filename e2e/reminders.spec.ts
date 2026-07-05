import { test, expect, seedPlaylist, routePlaylist, routeLiveManifest, type Page } from './helpers';

// channelKey mirrors src/utils/channel.ts (fnv1a of the URL sans query/fragment).
function channelKey(url: string): string {
  const stable = url.split('#')[0].split('?')[0];
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) { h ^= stable.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const CHAN_ONE = 'http://streams.example.com/one.m3u8';

async function seedDueReminder(page: Page): Promise<void> {
  await page.addInitScript((k) => {
    const now = Date.now();
    localStorage.setItem('iptv_reminders', JSON.stringify([
      { channelKey: k, channelName: 'Channel One', title: 'Alpha', startMs: now - 60000, stopMs: now + 3600000 },
    ]));
  }, channelKey(CHAN_ONE));
}

test('a due reminder prompts on open and Watch now opens the player', async ({ page }) => {
  await routePlaylist(page);
  await routeLiveManifest(page);
  await seedPlaylist(page);
  await seedDueReminder(page);

  await page.goto('/');

  await expect(page.locator('.reminder-prompt:not(.hidden)')).toBeVisible();
  await expect(page.locator('.reminder-message')).toContainText('Alpha');

  await page.locator('.reminder-btn[data-reminder-action="ok"]').click();
  await expect(page.locator('#view-player')).toBeVisible();
});

test('Cancel dismisses the prompt and stays on the channel list', async ({ page }) => {
  await routePlaylist(page);
  await routeLiveManifest(page);
  await seedPlaylist(page);
  await seedDueReminder(page);

  await page.goto('/');
  await expect(page.locator('.reminder-prompt:not(.hidden)')).toBeVisible();
  await page.locator('.reminder-btn[data-reminder-action="cancel"]').click();
  await expect(page.locator('.reminder-prompt.hidden')).toHaveCount(1);
  await expect(page.locator('#view-channels')).toBeVisible();
});
