import { test, expect, type Page } from '@playwright/test';

// Synthetic scenario: device at UTC, feed at +0100, "now" just before UTC
// midnight — so the feed's wall clock has already rolled to the next civil day.
// (Arbitrary fixed date; values chosen only to exercise the day-boundary math.)
test.use({ timezoneId: 'UTC' });
const NOW = new Date('2024-03-09T23:30:00Z'); // device-local Sat 03/09, feed Sun 03/10

const M3U = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="ch1" group-title="News",Channel 1',
  'http://streams.example.com/ch1.m3u8',
].join('\n');

// "Late night" starts on 03/09 and spills past feed midnight; the 03/10 schedule
// must not start with it. "Evening" ends exactly at feed midnight — which must
// NOT spawn an empty 03/11 column.
const EPG = `<?xml version="1.0" encoding="UTF-8"?><tv>
<channel id="ch1"><display-name>Channel 1</display-name></channel>
<programme channel="ch1" start="20240309234100 +0100" stop="20240310003000 +0100"><title>Late night</title></programme>
<programme channel="ch1" start="20240310003000 +0100" stop="20240310120000 +0100"><title>Morning</title></programme>
<programme channel="ch1" start="20240310120000 +0100" stop="20240311000000 +0100"><title>Evening</title></programme>
</tv>`;

async function setup(page: Page, tzMode: 'device' | 'feed'): Promise<void> {
  await page.route('http://127.0.0.1:8890/**', r => r.abort());
  await page.route('**/playlist.m3u', r => r.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: M3U }));
  await page.route('**/epg.xml', r => r.fulfill({ status: 200, contentType: 'application/xml', body: EPG }));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((mode) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{ name: 'P', url: 'http://host/playlist.m3u' }]));
    localStorage.setItem('iptv_epg_url', JSON.stringify('http://host/epg.xml'));
    localStorage.setItem('iptv_tz_mode', JSON.stringify(mode));
  }, tzMode);
}

async function openEpg(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 403, bubbles: true })));
  await expect(page.locator('#view-epg')).toBeVisible();
  await page.locator('#epg-dates .epg-date-item').first().waitFor();
}

const selectedDay = (page: Page) => page.locator('#epg-dates .epg-date-item.selected');
const todayDay = (page: Page) => page.locator('#epg-dates .epg-date-item.today');

test('feed mode: today is the feed day, selected, and its schedule starts after midnight', async ({ page }) => {
  await setup(page, 'feed');
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await openEpg(page);

  // Today in the feed zone is Sun 03/10 — highlighted and selected.
  await expect(todayDay(page)).toHaveText(/Sun\s+03\/10/);
  await expect(selectedDay(page)).toHaveText(/Sun\s+03\/10/);
  // The 23:41 programme belongs to 03/09, so 03/10 starts at 00:30 — not 23:41.
  await expect(page.locator('#epg-programmes .epg-prog-time').first()).toHaveText('00:30');
  // A programme ending exactly at midnight must not create an empty 03/11 column.
  await expect(page.locator('#epg-dates .epg-date-item')).toHaveCount(2);
});

test('switching device → feed re-snaps the selected day to today', async ({ page }) => {
  await setup(page, 'device');
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  await openEpg(page);
  await expect(selectedDay(page)).toHaveText(/Sat\s+03\/09/); // device-local today

  // Back to channels, open settings, switch to Feed, save.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(page.locator('#view-channels')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 406, bubbles: true })));
  await expect(page.locator('#view-settings')).toBeVisible();
  await page.locator('#tz-mode [data-value="feed"]').click();
  await page.locator('#save-settings').click();
  await expect(page.locator('#view-channels')).toBeVisible();

  await openEpg(page);
  // Selection must follow "today" into the new timezone, not stick on 03/09.
  await expect(selectedDay(page)).toHaveText(/Sun\s+03\/10/);
});
