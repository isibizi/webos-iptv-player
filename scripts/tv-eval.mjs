#!/usr/bin/env node
// Evaluate a JS expression inside the running webOS app's page over the Chrome
// DevTools Protocol — the headless counterpart of typing into the console
// `ares-inspect` opens. Use it to probe live app/DOM state from the terminal.
//
// Usage:
//   node scripts/tv-eval.mjs [--app <id>] [--port 9998] '<expression>'
//   node scripts/tv-eval.mjs [--app <id>] --file <path.js>   # read JS from a file
//   node scripts/tv-eval.mjs [--app <id>] -  <<'JS' … JS      # read JS from stdin
// Prefer --file / stdin for anything with backticks or `$` — the shell can't mangle it.
// IP comes from `ares-setup-device` (default device, or TV_DEVICE=<name>).
// The expression must return a JSON-serializable value (strings, numbers, plain
// objects) — DOM nodes and the like can't cross the protocol, so JSON.stringify
// what you need:
//   scripts/tv.sh eval --app <id> 'JSON.stringify(<expression>)'
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const appFilter = opt('--app', '');
const port = opt('--port', '9998');
const file = opt('--file', opt('-f', ''));
// Everything that isn't a recognized flag (or a flag's value) is the expression.
const flags = new Set(['--app', '--port', '--file', '-f']);
const positional = args
  .filter((a, i) => !flags.has(a) && !flags.has(args[i - 1]))
  .join(' ');
// Source the JS from `--file <path>` / `-f <path>`, stdin (`-`, e.g. a heredoc), or the
// positional arg. A file/stdin reads the bytes directly, so backticks / `$` / `${…}` in the
// expression survive — the shell never sees them (unlike inlining `"$(cat foo.js)"`).
let expression;
try {
  if (file) expression = readFileSync(file === '-' ? 0 : file, 'utf-8');
  else if (positional === '-') expression = readFileSync(0, 'utf-8');
  else expression = positional;
} catch (e) {
  console.error(`tv-eval: cannot read ${file || 'stdin'}: ${e.message}`);
  process.exit(2);
}
if (!expression.trim()) {
  console.error('tv-eval: no expression given.\n'
    + 'Usage: tv-eval.mjs [--app <id>] [--port 9998] (\'<expression>\' | --file <path.js> | -)');
  process.exit(2);
}

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
  console.error(`tv-eval: cannot resolve device IP from ares-setup-device: ${e.message}`);
  process.exit(1);
}

const base = `http://${ip}:${port}`;
let pages;
try {
  pages = await (await fetch(`${base}/json/list`)).json();
} catch {
  console.error(
    `tv-eval: no DevTools endpoint on ${ip}:${port}.\n` +
      `Enable it once with:  ares-inspect --device <dev> --app <id>`,
  );
  process.exit(1);
}

const page =
  pages.find((p) => p.type === 'page' && (!appFilter || p.description === appFilter || (p.url || '').includes(appFilter))) ||
  pages.find((p) => p.type === 'page');
if (!page) {
  console.error('tv-eval: no inspectable page found.');
  process.exit(1);
}

const wsUrl = page.webSocketDebuggerUrl.replace('localhost', ip).replace('127.0.0.1', ip);
const ws = new WebSocket(wsUrl);
let id = 0;
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const wantId = ++id;
    const onMessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== wantId) return;
      ws.removeEventListener('message', onMessage);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id: wantId, method, params }));
  });

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('ws connection failed'));
});

try {
  // awaitPromise resolves an async expression; returnByValue ships the result
  // back as JSON rather than a remote handle.
  const { result, exceptionDetails } = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    console.error(`tv-eval: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    process.exit(1);
  }
  if (result.type === 'undefined') console.log('undefined');
  else if (result.value !== undefined && typeof result.value === 'object') console.log(JSON.stringify(result.value, null, 2));
  else console.log(String(result.value ?? result.description ?? ''));
} catch (e) {
  console.error(`tv-eval: ${e.message}`);
  process.exit(1);
} finally {
  ws.close();
}
process.exit(0);
