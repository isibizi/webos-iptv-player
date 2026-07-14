#!/usr/bin/env node
// Stream the webOS app's DevTools console to the terminal over the Chrome
// DevTools Protocol — the same console `ares-inspect` shows in its GUI, but
// headless so it can be captured without copy-pasting out of a browser tab.
//
// Usage:
//   node scripts/tv-logs.mjs [--app <id>] [--port 9998] [--seconds N] [--history]
// IP comes from `ares-setup-device` (default device, or TV_DEVICE=<name>).
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const appFilter = opt('--app', '');
const port = opt('--port', '9998');
const seconds = parseInt(opt('--seconds', '0'), 10); // 0 = run until Ctrl-C
const history = args.includes('--history');

// Resolve the device IP from ares-setup-device (no secrets needed for CDP).
let ip;
try {
  const raw = execFileSync('ares-setup-device', ['-F', '-j'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  const list = JSON.parse(raw);
  const want = process.env.TV_DEVICE || '';
  const dev = list.find((d) => (want ? d.name === want : d.default)) || list[0];
  ip = dev?.deviceinfo?.ip;
  if (!ip) throw new Error('no device ip');
} catch (e) {
  console.error(`tv-logs: cannot resolve device IP from ares-setup-device: ${e.message}`);
  process.exit(1);
}

const base = `http://${ip}:${port}`;
let pages;
try {
  pages = await (await fetch(`${base}/json/list`)).json();
} catch {
  console.error(
    `tv-logs: no DevTools endpoint on ${ip}:${port}. ` +
      `Make sure the TV is on and the app is running:\n` +
      `  ares-launch ${process.env.TV_DEVICE ? `--device ${process.env.TV_DEVICE} ` : ''}${appFilter || '<app-id>'}`,
  );
  process.exit(1);
}

const page =
  pages.find((p) => p.type === 'page' && (!appFilter || p.description === appFilter || (p.url || '').includes(appFilter))) ||
  pages.find((p) => p.type === 'page');
if (!page) {
  console.error(
    `tv-logs: no inspectable page found on ${ip}:${port}` +
      (appFilter ? ` for "${appFilter}"` : '') + '. ' +
      `Make sure the TV is on and the app is running:\n` +
      `  ares-launch ${process.env.TV_DEVICE ? `--device ${process.env.TV_DEVICE} ` : ''}${appFilter || '<app-id>'}`,
  );
  process.exit(1);
}

const wsUrl = page.webSocketDebuggerUrl.replace('localhost', ip).replace('127.0.0.1', ip);
console.error(`tv-logs: attached to "${page.title}" (${page.description || page.url})`);

const ws = new WebSocket(wsUrl);
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

// Render a CDP RemoteObject argument as a short string.
const render = (a) => {
  if (a == null) return '';
  if ('value' in a) return typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value);
  if (a.unserializableValue != null) return String(a.unserializableValue);
  if (a.preview?.properties) {
    const body = a.preview.properties.map((p) => `${p.name}: ${p.value}`).join(', ');
    return a.subtype === 'array' ? `[${body}]` : `{${body}}`;
  }
  return a.description ?? a.type ?? '';
};
// Prefer the CDP event time (buffered history is replayed on attach, so
// receive-time would mislabel old entries as "now").
const stamp = (ts) => new Date(ts ?? Date.now()).toTimeString().slice(0, 8);

ws.onopen = () => {
  send('Runtime.enable');
  if (history) send('Log.enable'); // replays buffered browser-side log entries
  send('Console.enable');
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map(render).join(' ');
    const tag = m.params.type === 'log' ? '' : `.${m.params.type}`;
    console.log(`${stamp(m.params.timestamp)} [console${tag}] ${text}`);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log(`${stamp(m.params.timestamp)} [exception] ${d.exception?.description || d.text}`);
  } else if (m.method === 'Log.entryAdded') {
    console.log(`${stamp(m.params.entry.timestamp)} [${m.params.entry.level}] ${m.params.entry.text}`);
  }
};
ws.onerror = (e) => console.error('tv-logs: ws error', e.message || e);
ws.onclose = () => process.exit(0);

if (seconds > 0) setTimeout(() => ws.close(), seconds * 1000);
process.on('SIGINT', () => ws.close());
