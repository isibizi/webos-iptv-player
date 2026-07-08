# AGENTS.md

IPTV player for LG webOS TVs. Vanilla TypeScript (no UI framework), bundled with
esbuild and packaged as a webOS `.ipk`. A separate bundled webOS JS service
(`bundled-service/`) provides LAN M3U uploads over Luna + HTTP. App id
`com.lennylxx.iptv`; targets webOS 5+.

## Commands

```bash
npm install            # setup
npm run typecheck      # tsc --noEmit (TS strict mode — see TS strictness)
npm run lint           # stylelint + eslint webOS 5 / Chromium 68 browser-compat gate
npm run build          # typecheck + esbuild bundle into dist/
npm run preview        # build + serve dist/ at http://localhost:3000 (desktop video via hls.js/mpegts.js)
npm test               # vitest run (unit/integration)
npm run test:watch     # vitest watch
npm run test:e2e       # Playwright against the preview server
npm run test:all       # lint + unit + e2e
npm run screenshots    # regenerate README preview images
./build.sh             # package the IPK (needs ares-package from @webos-tools/cli)
./build.sh --install [device]   # build + ares-install + cold-restart on a TV
```

Run a single test by file or name:

```bash
npx vitest run src/parsers/m3u-parser.test.ts
npx vitest run -t "parses catchup-source"
```

There is **no Prettier/autoformatter**, but ESLint + stylelint are a real static
gate (`npm run lint`) alongside `tsc` strictness — see the webOS 5 compat gate under
Conventions. Run `npm run typecheck`, `npm run lint`, and the relevant tests before
considering a change done.

## CI

`.github/workflows/build.yml` runs typecheck (app **and** `service`),
`npm run lint` (the Chromium-68 compat gate), `vitest run`, the esbuild bundle, and
packages the IPK. Pushes/PRs to `main` build; tagged `v*` pushes publish a GitHub
release with the `.ipk`.

## Versioning

`package.json` `version` is the **single source of truth**. `esbuild.config.mjs`
syncs it into `appinfo.json` and the `__APP_VERSION__` build constant;
`scripts/sync-version.mjs` runs on `npm version`. **Never hand-edit the version in
`appinfo.json`.**

## Architecture

- **Entry `src/app.ts`** — the `App` class instantiates every component, owns a
  `viewStack`, and routes remote-control input. `KeyHandler`
  (`src/navigation/key-handler.ts`) maps key codes (`CONFIG.KEYS`) to a small
  `Action` union (`up`/`down`/`select`/`red`/… in `src/types.ts`); `App.handleKey`
  dispatches to the active view's `handleAction`.
- **Views** are plain `<div>`s in `index.html` (`channels`, `player`, `epg`,
  `settings`, `loading`) toggled with `show`/`hide` from `src/utils/dom.ts`.
- **Components** (`src/components/`) own a DOM subtree and re-render through
  `morph()` (`src/utils/morph.ts`), a keyed in-place DOM reconciler fed by the
  `html` tagged template. Reused nodes keep their listeners, focus, and scroll — so
  list items carry a stable `data-key`. **Do not rebuild subtrees with
  `innerHTML =`**; build a `Safe` with `` html`…` `` and pass it to `morph`. Bind
  listeners once (delegated), not per render.
- **Services** (`src/services/`) are singletons (exported object or single class
  instance): `PlaylistService`, `EpgService`, `StorageService`, `UploadClient`,
  `ReminderService`, `idb-cache`. `StorageService` wraps `localStorage` with the
  `iptv_` prefix + JSON and evicts the playlist cache on quota errors. EPG is cached
  in IndexedDB for instant reopen. `ReminderService` stores reminders, schedules an
  Activity Manager callback per reminder (dev-mode alert vs. retail toast), and
  resolves a launch param back to a channel.
- **Navigation** (`src/navigation/`) — `SpatialNav` does geometric D-pad focus
  among `[data-focusable]` elements (grouped by `[data-nav-container]`);
  `KeyHandler` also wires pointer/Magic-Remote and desktop mouse/wheel input.
- **Parsers** (`src/parsers/`) — `parseM3U` / `parseXMLTV` are pure functions; keep
  them tolerant of messy real-world feeds.
- **Config** (`src/config.ts`) — `CONFIG` holds key codes, refresh intervals,
  player/EPG/storage constants. Prefer constants here over magic numbers.
- **Bundled service** (`bundled-service/`) — a sandbox-separate Node (CommonJS) webOS
  service (`com.lennylxx.iptv.service`) hosting two features: LAN M3U **uploads** and,
  in Developer Mode, interactive program-reminder **alerts**. The app talks to it over
  the Luna bus (`start`/`stop`/`heartbeat`/`uploadEvents` for uploads; `getDevMode`/
  `fireReminderAlert` for reminders) and over HTTP; uploads **push** `uploadEvents` (no
  polling). Its lifecycle is tied to app `visibilitychange`. `index.ts` is a thin entry
  that wires the feature modules (`upload/`, `reminder/`).
  **Read `docs/upload-service.md` before changing it**, and keep the Luna/HTTP contract aligned with
  `src/services/upload-client.ts`.

## Conventions

- **webOS 5 target.** esbuild builds with `target: ['chrome68']` (webOS 5's
  Chromium). Modern syntax (`?.`, `??`, …) is fine — esbuild down-levels it — but
  modern *APIs* aren't polyfilled and silently fail on a real TV. `npm run lint` is
  the guard: `eslint-plugin-compat` plus a name denylist in `eslint.config.mjs`
  (keyed to the `chrome 68` `browserslist`) flags post-68 APIs — `.flat()`, `.at()`,
  `replaceAll`, `structuredClone`, … — that would otherwise hang the app on a blank
  loading screen. **Don't change the target without reason.**
- **Build-time constants** `__APP_VERSION__`, `__APP_ID__`, `__SERVICE_ID__` are
  injected via esbuild `define`. Keep all three in lockstep across
  `esbuild.config.mjs` (build), `vitest.config.ts` (tests), and the `declare const`
  in `src/globals.d.ts`.
- **XSS safety.** Channel names, programme titles, group titles, and logo URLs come
  from untrusted M3U/XMLTV. Always interpolate them through the `html` tagged
  template (auto HTML-escapes); only wrap genuinely trusted markup in `raw(...)`.
  There are e2e tests guarding this — don't regress it.
- **TS strictness.** `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns` are on — unused symbols fail `typecheck`/CI.
- **Tests** are colocated as `*.test.ts` next to source. Vitest defaults to the
  `node` environment; DOM-dependent tests opt in with `// @vitest-environment jsdom`
  as the **first line** of the file.
- **Synthetic identifiers only — in tests _and_ `docs/`.** No real channel names,
  brands, domains, URLs, audio-track names, or locale-specific language codes — not in
  fixtures, not in log samples, not in doc examples. Use `http://host/a`, `ch1`/`ch2`,
  `Track 1/2/3`, `l1`/`l2` (existing Alpha/Bravo/Charlie are fine).
- **Logging** uses `createLogger('Tag')` (`src/utils/logger.ts`); output is
  `[Tag]`-prefixed for filtering in `ares-inspect`. Prefer it over bare `console`.
- **Comments** are sparse — a one-line `//` only for non-obvious *why*. No JSDoc
  that just restates a name. Match the surrounding file's density.

## webOS platform gotchas

- **No exotic Unicode *symbols* in UI text.** The TV's `LG Smart UI` font renders
  whole scripts fine (Latin/Cyrillic/Greek/Korean, with a `LG_Display` fallback for
  the rest), but uncommon *symbols* (e.g. the replay arrow `↺`) fall through to a
  deep last-resort font the WebView won't reach and render as a blank box. Use an
  **inline SVG** (`fill: currentColor`) instead — that's why the EPG replay
  indicator is SVG.
- **Audio tracks switch via HTML5 `audioTracks[i].enabled`** on webOS (LG's Chromium maps
  it to the pipeline's `selectTrack`). The list holds one entry **per distinct `LANGUAGE`** —
  same-language renditions collapse, and entries carry empty `label`/`language`, so real names
  come from parsing the master `EXT-X-MEDIA`. **Don't** call `com.webos.media/selectTrack`
  directly: it's reachable but decode-errors on a track the pipeline didn't demux. Full
  writeup in `docs/audio-track-selection.md` (helpers in `src/utils/audio-tracks.ts`).
- **Subtitles switch via HTML5 `textTracks[i].mode`** (`'showing'`/`'disabled'`) on webOS and
  `hls.subtitleTrack` in the desktop preview. Unlike audio they're **off by default** (unless a
  rendition is `FORCED=YES`); the choice — including an explicit *off* — is remembered per
  channel, and real names come from parsing the master `EXT-X-MEDIA:TYPE=SUBTITLES`. On-device
  the native compositor draws the cues using the TV's caption settings (it ignores `::cue`); the
  preview's `::cue` mirrors Safari. Full writeup in `docs/hls-subtitles.md` (helpers in
  `src/utils/subtitle-tracks.ts`, `src/utils/webvtt.ts`, `src/services/hls-subtitles.ts`). VOD
  (Xtream movies/episodes) subtitles — in-container native tracks and sidecar SRT/WebVTT files —
  are a separate path in `docs/vod-subtitles.md` (`src/services/vod-subtitles.ts`,
  `src/utils/srt.ts`).
- **Magic Remote OK fires pointer events, not `click`.** Pressing OK with the Magic
  Remote pointer over an element dispatches `mousedown`/`mouseup` (and pointer events)
  but **no synthesized `click`**, and the event target can be the native video plane
  rather than the element under the cursor. Drive pointer-activated controls from
  `mouseup` by **coordinate hit-testing** (as the player's seek bar and the DVR
  play-pause / Go-to-Live controls do in `src/components/player.ts`), never from a
  `click` listener or `e.target`. A `click`-bound handler works with a desktop mouse
  but silently does nothing on the TV — and a Playwright `.click()` won't catch it, so
  reproduce it in a test by dispatching a bare `mouseup`.
- **Debugging:** `ares-inspect` gives a page-level CDP socket only (Playwright
  `connectOverCDP` fails — connect to the page WebSocket directly). App `console.*`
  is visible only via the DevTools `ares-inspect` opens; `ares-monitor-log` is not in
  the current CLI. `scripts/tv.sh` wraps device access the `tv` CLI profile blocks:
  `tv.sh logs [--app <id>]` tails the app's DevTools console headlessly over CDP (no
  GUI copy-paste), `tv.sh eval '<js>'` evaluates an expression in the app page over CDP
  (probe live DOM/app state from the terminal), and `tv.sh run '<cmd>'` / `push` /
  `shell` cover ssh/scp since `ares-shell`/`ares-push` are disabled in the `tv` profile.
- **`createAlert` is denied to third-party apps; `createToast` isn't.** On webOS the
  interactive `com.webos.notification/createAlert` (buttons) refuses every identity the
  app or its service can present (the block is identity-based in the notification
  daemon, not an `appinfo.json`/ACG gap). Passive `createToast` works. Only
  `/usr/bin/luna-send-pub` (Luna role `type:"devmode"`) may raise `createAlert`, and
  only while Developer Mode is on — so the bundled service execs it via
  `child_process` for the dev-mode reminder alert, and retail falls back to a toast +
  in-app prompt. Program reminders are scheduled through the Activity Manager
  (`com.webos.service.activitymanager` `create` with a `callback` + `schedule.start`,
  `local: true`), which fires the callback at air time **even with the app closed**;
  the dev callback targets the service's `fireReminderAlert`, the retail callback a
  `createToast`.
- **Install needs a cold restart.** webOS keeps the old instance suspended through an
  in-place upgrade and a plain relaunch resumes the stale in-memory copy.
  `build.sh --install` closes then cold-starts the app to load the new bundle.

## Working style

- Prefer small, surgical changes that fit the existing architecture rather than
  introducing a new state container, UI framework, or ad hoc pattern.
- When changing UI behavior, preserve the remote-control and desktop-preview
  experience; keep key handling, focus navigation, and view transitions consistent
  with the existing `App`/`KeyHandler`/component flow.
- When changing parsers, services, or bundled-service messaging, add or update the
  colocated tests for the touched module.

## Git

- Commit **directly to `main`** — no feature branch, no PR for this repo.
- **No `Co-Authored-By` trailer** in commit messages.
- Message length is proportional: small/mechanical changes get a tight one-line
  subject; real features get an imperative subject, a blank line, then a body
  wrapped at ~72 cols covering the key behaviors and the *why*, with a bullet
  list for supporting changes.
- Only commit or push when asked.
