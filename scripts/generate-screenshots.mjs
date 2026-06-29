// Generates the README screenshots — one per major view of the app.
//
//   node scripts/generate-screenshots.mjs
//
// It drives the *real* app (built into dist/) in headless Chromium with demo
// fixtures and a frozen clock, then captures each view into screenshots/:
//
//   channel-list.png   channel list (the README hero)
//   epg-guide.png      three-pane programme guide
//   settings.png       settings incl. the LAN-upload QR
//   player.png         playback overlays: channel switcher + action menu
//   channel-info.png   channel info bar (the OSD)
//
// Nothing here ships in the app or the .ipk; it is a dev-only tool.

import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SHOTS = join(ROOT, 'screenshots');
const SCALE = 1; // device pixel ratio — 1 = native 1920x1080 (no upsampling)

// Frozen clock: Friday 2026-06-12, 22:18 primetime (America/Los_Angeles).
const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-06-12T22:18:00-07:00').getTime();
const MID = new Date('2026-06-12T00:00:00-07:00').getTime(); // local midnight today
const HOUR = 3_600_000;
const UPLOAD_PORT = 8899;

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

// group title -> [count, recognisable lead names]. Titles are chosen so the
// genre-icon lookup resolves a real icon for every category. News leads, so it
// fills the visible rows.
// All channel and programme names below are fictional, to avoid using real
// broadcaster trademarks in marketing screenshots. Group titles stay generic
// (they also drive the genre-icon lookup in channel-list.ts).
const GROUPS = [
  ['News', 24, ['Metro One', 'Metro Two', 'Civic TV', 'Beacon TV', 'Globe News 24', 'Skyline News',
    'Vantage News', 'Continental 24', 'Northwind News', 'Ledger Business', 'Capital Markets TV',
    'Horizon News', 'Sentinel News', 'Meridian World', 'Atlas News', 'Frontier News',
    'Borealis News', 'Tribune 24']],
  ['Sports', 22, ['Apex Sports 1', 'Apex Sports 2', 'Tempo Sports', 'Stadium TV', 'Pitchside',
    'Overtime', 'Pole Position', 'Centre Court', 'Endzone', 'Fastbreak', 'Matchday']],
  ['Movies', 32, ['Grand Cinema', 'Silver Screen', 'Reel One', 'Noir Classics', 'Indie Reel',
    'Big Screen', 'Matinee', "Director's Cut", 'Starlight Movies', 'Epic Films', 'Popcorn TV']],
  ['Series', 28, ['Binge TV', 'Primetime', 'Drama Lab', 'The Box Set', 'Serial', 'Marathon TV',
    'Replay TV', 'Pilot', 'Spotlight Series', 'Saga']],
  ['Documentary', 18, ['Terra Docs', 'Wildlife One', 'Deep Dive', 'Chronicle', 'Wild Earth',
    'True Story', 'Wayfarer', 'Frontier Science', 'Archive']],
  ['Kids', 14, ['Kids Planet', 'Toonbox', 'Doodle TV', 'Junior Plus', 'Funhouse', 'Sprig TV',
    'Cub Club', 'Playground']],
  ['Music', 18, ['PulseMusic', 'Vibe TV', 'Hitlist', 'Amplify', 'Soundwave', 'ClubFloor',
    'Indie Sounds', 'Maestro', 'Beatbox']],
];

// "Now playing" titles for the visible (leading) channels.
const NOW_TITLES = {
  'Metro Two': 'The Night Desk', 'Civic TV': 'Civic Debate', 'Beacon TV': 'Beacon Tonight',
  'Globe News 24': 'Worldwatch', 'Skyline News': 'Skyline Tonight', 'Vantage News': 'The Big Story',
  'Continental 24': 'Round Table', 'Northwind News': 'Northwind at Nine', 'Ledger Business': 'Market Wrap',
  'Capital Markets TV': 'Trading Floor', 'Horizon News': 'Horizon Tonight', 'Sentinel News': 'The Briefing',
  'Meridian World': 'Nightly World',
};

function buildChannels() {
  const channels = [];
  let i = 0;
  for (const [group, count, leads] of GROUPS) {
    for (let n = 0; n < count; n++) {
      const name = n < leads.length ? leads[n] : `${group} ${n + 1}`;
      channels.push({ id: `ch${i}`, name, group });
      i++;
    }
  }
  return channels;
}

const CHANNELS = buildChannels();
const TOTAL = CHANNELS.length;
const SPLIT = 78; // News+Sports+Movies in playlist 1, the rest in playlist 2
const FAVORITE_IDS = ['ch1', 'ch3', 'ch6', 'ch20', 'ch45', 'ch70', 'ch110', 'ch140'];

function m3u(slice, withTvg) {
  const lines = [withTvg ? '#EXTM3U url-tvg="https://demo.local/epg.xml"' : '#EXTM3U'];
  for (const ch of slice) {
    lines.push(`#EXTINF:-1 tvg-id="${ch.id}" group-title="${ch.group}",${ch.name}`);
    lines.push(`https://demo.local/stream/${ch.id}.m3u8`);
  }
  return lines.join('\n');
}

const M3U_1 = m3u(CHANNELS.slice(0, SPLIT), true);
const M3U_2 = m3u(CHANNELS.slice(SPLIT), false);

// Fake HLS master with alternate audio + subtitle renditions, served for the played
// channel so hls.js (the desktop preview path) exposes real tracks to the player
// menu — that's what makes renderMain emit the Audio Track / Subtitles rows. Only the
// master is served; the media playlists it points to are aborted (the menu needs just
// the track lists, which come from these EXT-X-MEDIA tags). Labels are illustrative.
const MASTER_HLS = [
  '#EXTM3U',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio-en.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English 5.1",LANGUAGE="en",CHANNELS="6",URI="audio-en51.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",URI="audio-es.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Français",LANGUAGE="fr",URI="audio-fr.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="English",LANGUAGE="en",FORCED=YES,AUTOSELECT=YES,URI="sub-en.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Español",LANGUAGE="es",URI="sub-es.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Français",LANGUAGE="fr",URI="sub-fr.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud",SUBTITLES="sub"',
  'video.m3u8',
].join('\n');

// Feature-rich variant for the channel-info OSD shot — 4K HDR Dolby Vision, Dolby
// Digital+ Atmos (default audio gets CHANNELS="16/JOC"), 60fps.
const MASTER_HLS_RICH = MASTER_HLS
  .replace('NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES',
    'NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="16/JOC"')
  .replace(/#EXT-X-STREAM-INF:.*\n[^\n]*$/,
    '#EXT-X-STREAM-INF:BANDWIDTH=16000000,RESOLUTION=3840x2160,FRAME-RATE=60,VIDEO-RANGE=PQ,' +
    'CODECS="dvh1.05.06,ec-3",AUDIO="aud",SUBTITLES="sub"\nvideo.m3u8');

// Empty *live* media playlist (no ENDLIST, no segments) for the variant/audio/
// subtitle renditions hls.js loads after the master. It keeps polling for a live
// edge rather than fatally erroring — which would make the player flash "Stream
// error - trying next channel" and zap mid-screenshot.
const EMPTY_LIVE = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n';

// ---------------------------------------------------------------------------
// EPG (XMLTV)
// ---------------------------------------------------------------------------

function xmltvTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`;
}
const at = (hoursFromMidnight) => MID + Math.round(hoursFromMidnight * HOUR);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Metro One's full schedule for today — drives the programme-guide pane and the
// channel-list/OSD "now/next". The 22:00 slot straddles the frozen clock.
const HERO_SCHEDULE = [
  [16.0, 17.25, 'Country Escapes', 'A couple search for their dream rural home with a generous budget and a long wish list.'],
  [17.25, 18.0, 'Brain Game', 'Quiz show in which contestants try to find the most obscure correct answers.'],
  [18.0, 19.0, 'Evening News', 'The latest national and international news, plus sport and weather.'],
  [19.0, 19.5, 'Tonight', 'Topical magazine show with celebrity guests and the stories of the day.'],
  [19.5, 20.0, 'Riverside', 'Drama in a close-knit neighbourhood as tensions rise at the local pub.'],
  [20.0, 21.0, 'The Garden Show', 'Seasonal advice and inspiration from the team and their gardens.'],
  [21.0, 22.0, 'The Evening Debate', 'Topical debate from a different town each week with a panel of guests.'],
  [22.0, 22.5, 'Metro News at Ten', "The day's top stories with the latest analysis, plus sport and the weather forecast for the week ahead."],
  [22.5, 23.25, "Tomorrow's Papers", "A lively look at the next day's front pages with guests from across the press."],
  [23.25, 24.5, 'Feature Film: Midnight Protocol', 'An intelligence operative crosses continents to uncover the truth about his past. Action thriller.'],
];

function epgXml() {
  const epgChannels = CHANNELS.slice(0, 14);
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>'];
  for (const ch of epgChannels) {
    parts.push(`<channel id="${ch.id}"><display-name>${esc(ch.name)}</display-name></channel>`);
  }
  const prog = (id, start, stop, title, desc) =>
    `<programme channel="${id}" start="${xmltvTime(start)}" stop="${xmltvTime(stop)}">` +
    `<title>${esc(title)}</title>${desc ? `<desc>${esc(desc)}</desc>` : ''}</programme>`;

  // Hero channel: full day + neighbouring-day stubs so the date bar spans a week.
  for (const [s, e, title, desc] of HERO_SCHEDULE) {
    parts.push(prog('ch0', at(s), at(e), title, desc));
  }
  for (const d of [-2, -1, 1, 2, 3]) {
    parts.push(prog('ch0', at(d * 24 + 20), at(d * 24 + 21), d < 0 ? 'Highlights' : 'Coverage', ''));
  }
  // Every other visible channel: a current programme so the list shows a "now" line.
  for (const ch of epgChannels.slice(1)) {
    parts.push(prog(ch.id, at(22), at(22.5), NOW_TITLES[ch.name] || `${ch.name} Live`, ''));
  }
  parts.push('</tv>');
  return parts.join('\n');
}

const EPG_XML = epgXml();

// Two demo uploaded playlists for the settings screenshot.
const UPLOADS = [
  { id: 'living-room', name: 'Living Room', count: 84, createdAt: NOW - 3_600_000, url: `http://127.0.0.1:${UPLOAD_PORT}/uploads/living-room.m3u` },
  { id: 'sports-pack', name: 'Sports Pack', count: 36, createdAt: NOW - 7_200_000, url: `http://127.0.0.1:${UPLOAD_PORT}/uploads/sports-pack.m3u` },
];
const SERVICE_INFO = { ip: '192.168.1.42', port: UPLOAD_PORT, uploadUrl: `http://192.168.1.42:${UPLOAD_PORT}/upload` };

// ---------------------------------------------------------------------------
// Static file server for dist/
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
};

function startServer() {
  const dist = join(ROOT, 'dist');
  const server = createServer(async (req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const data = await readFile(join(dist, url));
      res.writeHead(200, { 'Content-Type': MIME[extname(url)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// Page setup shared by every view
// ---------------------------------------------------------------------------

const fulfill = (body, type) => (route) =>
  route.fulfill({ status: 200, contentType: type, headers: { 'access-control-allow-origin': '*' }, body });

async function setupPage(page, { upload = false, fakeStream = false } = {}) {
  // Freeze the clock before any app code runs (real timers keep working).
  await page.addInitScript((fixed) => {
    const RealDate = Date;
    function FakeDate(...args) {
      if (!(this instanceof FakeDate)) return RealDate(...args);
      return args.length ? new RealDate(...args) : new RealDate(fixed);
    }
    FakeDate.now = () => fixed;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    FakeDate.prototype = RealDate.prototype;
    window.Date = FakeDate;
  }, NOW);

  // Seed configured playlists, EPG URL and favorites.
  await page.addInitScript((favs) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { name: 'Playlist 1', url: 'https://demo.local/playlist1.m3u' },
      { name: 'Playlist 2', url: 'https://demo.local/playlist2.m3u' },
    ]));
    localStorage.setItem('iptv_epg_url', JSON.stringify('https://demo.local/epg.xml'));
    localStorage.setItem('iptv_favorites', JSON.stringify(favs));
  }, FAVORITE_IDS);

  // Fake the Luna service bus so the upload service "runs" (settings QR).
  if (upload) {
    await page.addInitScript((port) => {
      window.webOS = {
        service: {
          request(_uri, opts) {
            const m = opts && opts.method;
            if (m === 'start') setTimeout(() => opts.onSuccess && opts.onSuccess({ running: true, port }), 0);
            else if (m === 'uploadEvents') setTimeout(() => opts.onSuccess && opts.onSuccess({ subscribed: true }), 0);
            else if (m === 'stop') setTimeout(() => opts.onSuccess && opts.onSuccess({ stopped: true }), 0);
            else setTimeout(() => opts.onFailure && opts.onFailure({ errorText: 'unmocked: ' + m }), 0);
            return { cancel() { /* no-op */ } };
          },
        },
      };
    }, UPLOAD_PORT);
  }

  await page.route('**/playlist1.m3u', fulfill(M3U_1, 'application/x-mpegurl'));
  await page.route('**/playlist2.m3u', fulfill(M3U_2, 'application/x-mpegurl'));
  await page.route('**/epg.xml', fulfill(EPG_XML, 'application/xml'));
  // By default abort the played channel's stream — the list/OSD shots don't need
  // video and are captured before hls.js's error escalates. The menu collage opts in
  // (fakeStream) to a fake master with audio/subtitle renditions so hls.js surfaces
  // real tracks; the rest of its (empty) playlists keep it from erroring instantly.
  if (fakeStream) {
    await page.route('**/stream/**', (route) => {
      const url = route.request().url();
      if (/\/stream\/ch\d+\.m3u8(?:[?#]|$)/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl',
          headers: { 'access-control-allow-origin': '*' }, body: MASTER_HLS });
      }
      if (/\.m3u8(?:[?#]|$)/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl',
          headers: { 'access-control-allow-origin': '*' }, body: EMPTY_LIVE });
      }
      return route.abort();
    });
  } else {
    await page.route('**/stream/**', (r) => r.abort());
  }
  await page.route('http://127.0.0.1:8890/**', (r) => r.abort());

  if (upload) {
    await page.route(`http://127.0.0.1:${UPLOAD_PORT}/info`, fulfill(JSON.stringify(SERVICE_INFO), 'application/json'));
    await page.route(`http://127.0.0.1:${UPLOAD_PORT}/uploads`, fulfill(JSON.stringify(UPLOADS), 'application/json'));
    await page.route(`http://127.0.0.1:${UPLOAD_PORT}/uploads/**`, (r) => r.abort());
  }
}

// Dispatch a webOS remote keycode (colored buttons aren't real keyboard keys).
const KEY = { RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
async function remote(page, keyCode) {
  await page.evaluate((kc) => document.dispatchEvent(
    new KeyboardEvent('keydown', { keyCode: kc, bubbles: true })), keyCode);
}

const clearToasts = (page) =>
  page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

// Capture to screenshots/<name>. Disabling animations freezes the infinite
// CSS loops (the playing-indicator pulse, sidebar marquee) that otherwise keep
// the compositor busy and intermittently fail Page.captureScreenshot.
async function shoot(page, name) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.screenshot({ path: join(SHOTS, name), animations: 'disabled', caret: 'hide' });
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(300);
    }
  }
}

async function gotoChannels(page, base) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('#view-channels').waitFor({ state: 'visible' });
  await page.locator('.channel-main .channel-now').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.group-icon .group-logo').first().waitFor({ state: 'visible' });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Building app (esbuild)...');
execSync('node esbuild.config.mjs', { cwd: ROOT, stdio: 'inherit' });
await mkdir(SHOTS, { recursive: true });

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log('Serving dist/ at', base);

const browser = await chromium.launch();
const newPage = async (opts) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE, timezoneId: TZ });
  const page = await context.newPage();
  await setupPage(page, opts);
  return { context, page };
};

try {
  // 1) Channel list (the hero) — first channel playing + focused, no OSD.
  {
    const { context, page } = await newPage();
    await gotoChannels(page, base);
    await page.keyboard.press('ArrowDown'); // focus the first channel
    await page.keyboard.press('Enter');     // play it...
    await page.locator('#player-osd .osd-programme-title').waitFor({ state: 'visible' });
    await remote(page, 27);                 // ...then Back, so the list marks it playing (▶) — no OSD
    await page.locator('.channel-main [data-channel-index="0"].playing').waitFor({ state: 'visible' });
    await clearToasts(page);
    await page.waitForTimeout(400);
    await shoot(page, 'channel-list.png');
    console.log('  channel-list.png');
    await context.close();
  }

  // 2) Programme guide (EPG).
  {
    const { context, page } = await newPage();
    await gotoChannels(page, base);
    await remote(page, KEY.RED); // open EPG
    await page.locator('#view-epg').waitFor({ state: 'visible' });
    await page.locator('.epg-now-badge').first().waitFor({ state: 'visible', timeout: 10_000 });
    await clearToasts(page);
    await page.waitForTimeout(400);
    await shoot(page, 'epg-guide.png');
    console.log('  epg-guide.png');
    await context.close();
  }

  // 3) Settings (incl. LAN-upload QR + uploaded playlists).
  {
    const { context, page } = await newPage({ upload: true });
    await gotoChannels(page, base);
    await remote(page, KEY.BLUE); // open settings
    await page.locator('#view-settings').waitFor({ state: 'visible' });
    await page.locator('.upload-qr').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#upload-entries .settings-row').first().waitFor({ state: 'visible', timeout: 10_000 });
    await clearToasts(page);
    await page.waitForTimeout(300);
    await shoot(page, 'settings.png');
    console.log('  settings.png');
    await context.close();
  }

  // 4) Playback overlays — channel switcher (left) + action menu (right), no OSD.
  {
    const { context, page } = await newPage({ fakeStream: true });
    await gotoChannels(page, base);
    await page.keyboard.press('ArrowDown');
    // hls.js requests the (aborted) media playlists only after parsing the master, so
    // this confirms the audio/subtitle track lists are populated before the menu opens
    // — it renders once, on open, and isn't re-rendered when tracks arrive later.
    const tracksReady = page.waitForRequest(/\/stream\/(?:video|audio-|sub-)/, { timeout: 10_000 }).catch(() => {});
    await page.keyboard.press('Enter');
    await page.locator('#player-osd .osd-programme-title').waitFor({ state: 'visible' });
    await tracksReady;
    // The app shows these one at a time. Open the menu so it renders (with the real
    // Audio Track / Subtitles rows), then open the sidebar; the menu's content
    // persists and is forced back on below.
    await page.keyboard.press('ArrowRight'); // open menu (renders content)
    await page.locator('#player-menu.visible').waitFor({ state: 'visible' });
    await page.keyboard.press('ArrowLeft');  // hide menu...
    await page.keyboard.press('ArrowLeft');  // ...open the channel switcher
    await page.locator('#player-sidebar.visible').waitFor({ state: 'visible' });
    await page.keyboard.press('ArrowDown');  // highlight the playing channel
    await page.evaluate(() => {
      const v = document.getElementById('video-player');
      if (v) { v.classList.remove('active'); try { v.pause(); } catch { /* ignore */ } }
      // hls.js can't play the fake stream, so onError() re-shows #player-osd with a
      // "Stream error" message shortly after a plain hide. An !important rule beats
      // that show(), keeping the OSD out of this collage (channelUp won't fire in time).
      const hideOsd = document.createElement('style');
      hideOsd.textContent = '#player-osd{display:none !important}';
      document.head.appendChild(hideOsd);
      // Force the menu back alongside the sidebar (collage of both overlays).
      // Inline !important beats both the .hidden rule and the pending hide
      // transition's transitionend, which would otherwise re-add .hidden.
      const menu = document.getElementById('player-menu');
      if (menu) {
        menu.classList.remove('hidden');
        menu.classList.add('visible');
        menu.style.setProperty('display', 'flex', 'important');
        menu.style.setProperty('transform', 'translateX(0)', 'important');
      }
      const vp = document.getElementById('view-player');
      if (vp) vp.style.background = 'radial-gradient(125% 110% at 50% 28%, #182942 0%, #0b0b12 62%)';
    });
    await clearToasts(page);
    await page.waitForTimeout(400);
    await shoot(page, 'player.png');
    console.log('  player.png');
    await context.close();
  }

  // 5) Channel info bar (the OSD) — driven by the feature-rich master so the
  //    stream-info pills all show.
  {
    const { context, page } = await newPage({ fakeStream: true });
    // (screenshot-only) Fake a 4K frame for the resolution badge, and make hls.js
    // keep the Dolby Vision / E-AC-3 level even where headless Chromium can't decode
    // it (no fragments load, so nothing actually decodes).
    await page.addInitScript(() => {
      if (window.MediaSource) MediaSource.isTypeSupported = () => true;
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 3840 });
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 2160 });
    });
    await page.route(/\/stream\/ch\d+\.m3u8(?:[?#]|$)/, fulfill(MASTER_HLS_RICH, 'application/vnd.apple.mpegurl'));
    await gotoChannels(page, base);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('#player-osd .osd-programme-title').waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const v = document.getElementById('video-player');
      if (v) { v.classList.remove('active'); try { v.pause(); } catch { /* ignore */ } v.dispatchEvent(new Event('loadedmetadata')); }
      const vp = document.getElementById('view-player');
      if (vp) vp.style.background = 'radial-gradient(125% 110% at 60% 32%, #182942 0%, #0b0b12 62%)';
    });
    await clearToasts(page);
    await page.waitForTimeout(400);
    await shoot(page, 'channel-info.png');
    console.log('  channel-info.png');
    await context.close();
  }

  console.log(`Done — ${TOTAL} channels, scale ${SCALE}x.`);
} finally {
  await browser.close();
  server.close();
}
