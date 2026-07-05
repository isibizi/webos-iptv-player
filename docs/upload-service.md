# Upload Service

A bundled webOS JS service that lets a phone or computer on the same LAN
upload an `.m3u` playlist to the TV. The TV-side app consumes those uploads
through Luna and shows them in **Settings → Upload Playlist**.

## Architecture

```
┌──────────────────┐  Luna  ┌─────────────────────────────┐  HTTP  ┌──────────────────┐
│ App (browser)    │◀──────▶│  Bundled service            │◀──────▶│  Phone / laptop  │
│  src/app.ts      │        │  com.lennylxx.iptv.service  │  LAN   │  upload page     │
│  upload-client.ts│        │                             │        │  (/upload)       │
└──────────────────┘        └─────────────────────────────┘        └──────────────────┘
            ▲                             │
            └─────── uploadEvents ────────┘    push notification on every change
```

- **Luna bus** — in-process IPC between the app and the service.
- **HTTP** — `0.0.0.0:<ephemeral>` for phones, `127.0.0.1:<same>` for the app's reconcile fetches.

## APIs

The service exposes **4 Luna methods** and **5 HTTP routes**.

Luna (called by the in-app `UploadClient` / `app.ts`):

| Method | Subscribe? | Purpose |
|---|---|---|
| `start` | no | Bind the HTTP server; returns the bound port. Idempotent. |
| `stop` | no | Close the HTTP server and release the keepAlive activity. |
| `heartbeat` | no | Liveness probe; returns `{running, port}`. |
| `uploadEvents` | **yes** | Push channel — service emits `{event: 'uploads-changed'}` after every successful upload or delete. |

HTTP (called by phones, and by the app for reconcile):

| Route | Method | Purpose |
|---|---|---|
| `/info` | GET | Service metadata (ip, port, uploadUrl, dataDir). |
| `/upload` | GET | The HTML drag-and-drop page phones load. |
| `/uploads` | GET | List all stored uploads with serve-back URLs. |
| `/uploads?name=foo.m3u` | POST | Save a playlist; fires `uploadEvents`. |
| `/uploads/:id[.m3u]` | GET / DELETE | Serve or remove a stored playlist; DELETE fires `uploadEvents`. |

## Event-driven updates

When a phone uploads or deletes a playlist, the in-app Settings view
refreshes within milliseconds. There is **no polling**.

A successful POST or DELETE on the HTTP side calls an `onChange` hook,
which iterates a `Set<msg>` of active `uploadEvents` subscribers and calls
`msg.respond({event: 'uploads-changed'})` on each one. The app's
subscription handler then runs `Settings.refreshUploads()`, which
re-fetches `/uploads`, updates `localStorage`, and patches the upload
list in the DOM.

Rejected uploads (HTTP 400) and missing-id deletes (HTTP 404) do **not**
fire the event.

State is server-authoritative; the push is just a hint to refresh. If the
app misses a push (e.g. it's mid-restart), the next `Settings.render()`
runs `refreshUploads()` on open and picks up the new state.

## Foreground / background lifecycle

The service is tied to the app's visibility. When the app is backgrounded
(`visibilitychange → hidden`) the app calls Luna `stop`, which closes the
HTTP listener and releases the `keepAlive` activity — neither the LAN
port nor the service process lingers while other webOS apps are in use.

When the app is foregrounded (`visibilitychange → visible`) it calls
Luna `start` again, which re-binds the HTTP server on a new ephemeral
port and resubscribes to `uploadEvents`. `Settings.refreshUploads()`
runs so the QR code and upload list reflect the new port and current
state.

The service process itself stays alive across stop/start cycles — only
the HTTP server is torn down. Luna respawns the process on cold start
(first call to `start` after a TV reboot or app uninstall).

## Why this shape?

- **Why a separate process?** webOS sandboxes the app and won't let it
  open a server socket on a non-loopback interface. The bundled service
  runs alongside but independently.
- **Why an OS-assigned port?** A fixed port (e.g. 8890) collides
  unpredictably with whatever else is running on the TV. The OS-assigned
  port is reported back through Luna's `start` response, so the app and
  the phone always agree.
- **Why Luna push and not polling?** Polling wakes the device ~20×/min
  per active Settings view to detect a change that happens maybe twice
  per session, and adds 1–3s lag. Push is built into the platform — one
  `subscribe: true` request from the app, `msg.respond()` from the
  service.
- **Why stop/start on background?** Holding an open LAN port and a
  keepAlive activity while the app is invisible is wasteful and a small
  attack surface. Closing it on hidden costs only a fresh `listen(0)`
  when the app returns.
- **Why M3U only — why not EPG upload too?** The upload plumbing is
  content-agnostic and could carry an XMLTV file just as easily, but it
  would be the wrong model for EPG:
  - **EPG is time-sensitive; an upload is a frozen snapshot.** The app
    refreshes EPG every 12h and keeps only a ±7-day programme window
    (`src/services/epg-service.ts`, `src/parsers/xmltv-parser.ts`). An
    uploaded XMLTV file is stale within a day or two and effectively
    empty within a week — so the user would have to re-upload every
    couple of days, forever. A playlist, by contrast, is static: upload
    once and it stays valid. Upload fits M3U precisely because M3U
    doesn't expire.
  - **EPG almost always travels as a URL.** It's embedded in the M3U
    header (`x-tvg-url` / `url-tvg`, auto-detected) or fetched from a
    public aggregator. The "I have a file but no hosted URL" gap that
    justifies M3U upload barely exists for EPG.
  - **The local-source case is already covered — and stays fresh.** The
    manual EPG URL field in **Settings → EPG**, plus the
    localhost→playlist-host rewrite in `src/services/playlist-service.ts`
    (for users running a local proxy like xTeVe/Threadfin that serves
    M3U and XMLTV from the same box), let the TV *pull* fresh EPG by URL.
    Pull stays current automatically; a push upload does not. For EPG,
    pull strictly dominates.

  If genuine demand for fully offline, file-based EPG ever shows up, the
  better shape is a per-playlist EPG URL the TV can re-pull, not a
  one-shot upload that throws away the freshness guarantee.
