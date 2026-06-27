# webOS HLS Subtitles

Reference for how this app handles HLS subtitles on LG webOS — the render paths, rendition
selection, the self-rendered WebVTT sync model, and spec-robustness.

| | |
|---|---|
| **Platform** | webOS TV **10.3.1**, Chromium/Blink **120** |
| **Code** | `src/services/hls-subtitles.ts`, `src/utils/webvtt.ts`, `src/utils/subtitle-tracks.ts`, `css/player.css` |
| **Specs** | RFC 8216 (HLS), draft-pantos-hls-rfc8216bis (X-TIMESTAMP-MAP, fMP4/IMSC), W3C WebVTT |

---

## 0. TL;DR

- The app plays HLS via **native `<video src>`** on-device; hls.js is used only in the desktop preview.
- The native HLS demux handles three in-manifest subtitle types — **WebVTT renditions**,
  **CEA-608/708**, **TTML/IMSC** — but it does **not** surface in-manifest WebVTT renditions as
  switchable HTML `TextTrack`s. So for WebVTT on-device we **self-render**: fetch the subtitle
  playlist, parse the segments, and inject `VTTCue`s into a `TextTrack` we own (`HlsSubtitles`).
- Subtitles are **off by default** (unless a rendition is `FORCED=YES`); the choice — including an
  explicit *off* — is **remembered per channel**. Real names come from the master `EXT-X-MEDIA`.
- Our self-rendered cues are drawn by **Blink** (`VTTCueBox`) **both on-device and in the preview**, so
  **`::cue` styling applies on the TV too** — the `<c.cyan>`/… speaker colours render on-device (✅
  confirmed), not just in the preview. Blink decodes WebVTT entities and parses cue-tag markup, so we
  pass raw cue text straight through. (The TV's GStreamer caption compositor draws only *pipeline* subs —
  CEA-608/708, TTML — not our injected `VTTCue`s.)
- `getStartDate()` (wall-clock of `currentTime=0`) is **NaN** for HLS here ✅, so `HlsSubtitles`
  **reconstructs** it from the video feed's *oldest* `PROGRAM-DATE-TIME` vs `seekable.start` — the
  timeline start, free of the live-edge buffering hold-back that biases `seekable.end`. Cues then anchor
  at media 0 like a real `getStartDate`; it falls back to the live edge only when the video feed has no PDT.

---

## 1. Playback & render paths

| Path | Subtitle engine | Used by |
|---|---|---|
| **Native `<video src>`** | self-rendered WebVTT → **Blink** (`VTTCueBox`, `::cue`-styled); in-band CEA-608/708 & TTML → native compositor | **on-device** |
| **MSE (hls.js)** | Blink 120 text-track + `::cue` | desktop preview only |

Native video plays on a punch-through "video-hole" plane, so subtitles are **not burned in** — they're
a web overlay the engine draws from `video.textTracks`, gated by `track.mode`. Setting
`track.mode = 'showing'` tells the engine to render a track; `'disabled'` turns it off. (LG's
Blink maps this onto the pipeline's subtitle `selectTrack`, the same way `audioTracks[i].enabled` maps
for audio — the on-device-verified audio path this mirrors is in
[`audio-track-selection.md`](audio-track-selection.md).)

### Confirmed on device
- **`getStartDate()` → `Invalid Date` (`.getTime()` = NaN) for HLS.** ✅ The native HLS demux never
  surfaces `EXT-X-PROGRAM-DATE-TIME` as a media-timeline offset, so the wall-clock-of-`currentTime=0`
  anchor is empty. (Same with MSE in desktop Chrome — **(standard)**.) Sync must anchor elsewhere (§3).
- **Blink decodes entities, parses cue tags, and `::cue` styles them on-device.** ✅ A `VTTCue` with
  text `a&amp;b <c.red>RED</c> &lt;x&gt;` draws as `a&b RED <x>` on the TV — entities decoded; the
  `<c.red>` span's `getCueAsHTML().textContent` is the plain text, but the span **renders coloured by
  `::cue(.red)`**. So **don't pre-decode**; pass raw cue text through. The `<c.class>` speaker colours
  (`::cue(.cyan)`/… in `css/player.css`) render on the TV — ✅ confirmed on-device. (An earlier version
  of this note wrongly claimed they were uncoloured; it conflated the stripped `textContent` with the
  painted result.)

To re-verify the renderer on another device, paste into the `ares-inspect` console while playing:
```js
const v = document.querySelector('video'), t = v.textTracks[0];
const cue = new VTTCue(v.currentTime + 1, v.currentTime + 7, 'TEST a&amp;b <c.red>RED</c> &lt;x&gt;');
t.addCue(cue);
const box = document.createElement('div'); box.appendChild(cue.getCueAsHTML());
console.log('blink:', box.textContent);   // "TEST a&b RED <x>" — compare to what the TV draws
```

---

## 2. Selecting a subtitle (picker + per-channel memory)

Helpers in `src/utils/subtitle-tracks.ts`; mirrors the audio-track feature.

- **Off unless forced** — `chooseSubtitleIndex(options, pref)`:

  | Saved pref | Result |
  |---|---|
  | none | the `FORCED=YES` track if any, else **off** |
  | explicit *off* | **off** (even if a forced track exists) |
  | a track (by name → language) | that track; else fall back to forced / off |

  `DEFAULT=YES` does **not** auto-enable — it only marks which track to prefer *once subtitles are on*.
  Only `FORCED=YES` turns them on without a user choice.
- **Switch:** native path sets `video.textTracks[i].mode` (`'showing'` on the pick, `'disabled'` on the
  rest; all `'disabled'` = off); preview uses `hls.subtitleTrack = i` (`-1` = off) with
  `hls.subtitleDisplay`.
- **Per-channel memory:** `{ off, name, lang }` keyed by `channelKey`, re-applied on tune-in.
  Storing an explicit `off` is what lets "I turned subtitles off here" survive a re-tune.
- **Real names:** native text tracks can surface with empty `label`/`language`, so names — and the
  `FORCED`/`DEFAULT` flags native tracks don't carry — come from parsing the master
  `EXT-X-MEDIA:TYPE=SUBTITLES` (`parseSubtitleRenditions` → `mergeSubtitleManifestNames`, overlaid by
  index only when the counts match).
- **Labels:** `subtitleLabel` shows the rendition `NAME`; with none, the language rendered as its
  **endonym** (its own-language name — `languageName` via `iso-639-1` + `iso-639-2` to fold 3-letter
  codes to 2), then a positional `Subtitle N`.
- **Styling:** `#video-player::cue` (in `css/player.css`) styles the cues via Blink — **on-device as
  well as in the preview**: white text on `rgba(0,0,0,0.8)`, plus the `<c.class>` speaker colours (✅
  the colours were confirmed on the TV). The TV's own caption settings in `com.webos.settingsservice`
  category `caption` govern the *pipeline* compositor; whether they also override `::cue` font/size for
  our Blink-drawn cues isn't pinned, but the `::cue` colour clearly wins.

---

## 3. Self-rendered WebVTT (`HlsSubtitles`) — sync model

Because the native pipeline won't expose in-manifest WebVTT as a switchable track, `HlsSubtitles`
fetches the subtitle media playlist itself, parses each segment, and injects `VTTCue`s into a
`TextTrack` it owns. Sync is the hard part.

**Anchor (wall-clock → media time).** `getStartDate()` is NaN (§1), so `maybeCalibrate` **reconstructs**
it. The naive fix — pin the live edge, `seekable.end` ↔ the newest segment's `PROGRAM-DATE-TIME` — runs
cues seconds early: the pipeline holds `seekable.end` behind the playlist's true live edge by a buffering
hold-back (≈2–6s, varying). So we anchor at the **start** of the timeline, which carries no hold-back —
the **video feed's oldest PDT ↔ `seekable.start`** — giving `startDate = oldestPDT − seekable.start·1000`
(slope 1, constant: both slide together at 1×). `seekable.start` and the oldest segment are quantized to
~segment boundaries, so each sample is noisy by ±~half-a-segment; `startDate` is fixed per session, so we
**average** several samples (a low percentile, `lowPercentile`) until it settles, then anchor cues at
media 0. If the video feed carries no PDT, sync falls back to the live edge, accepting the hold-back skew.
A small **per-channel residual** can remain — a genuine publish-time offset between the subtitle and video
feeds, not estimator error.

- Cue media time = `anchor.media + (cueWall − anchor.wall)/1000` (slope 1; live plays at 1×, **no fudge
  offset** — an earlier hardcoded `+10s` made cues late).
- Each cue's wall clock comes from **its own segment's PDT** (per-segment, so a sliding window doesn't
  matter): `segmentPDT + (cueStart − local)`, where `local` is the `X-TIMESTAMP-MAP LOCAL` anchor —
  or, for **media-clock streams** that number cues along the whole timeline (`LOCAL:0`, cue at e.g.
  `03:21:40`), the segment's own first-cue time.
- **Boundary-split captions:** when one caption straddles a segment boundary, broadcasters re-emit it as
  two (sometimes three) abutting **same-text** cues (`15.720→16.000` then `16.000→16.920`). Two passes
  handle this: dedup keys on **start+end** (not a rounded second) so a true re-add is dropped while both
  halves of a split survive; then `mergeSameTextCues` coalesces an adjacent same-text run (gaps ≤
  `MERGE_GAP_S`) into one continuous cue. Without the merge the abutting cues overlapped and the line
  flickered; without the precise key a coarse one dropped the second, often-longer half and the caption
  flashed too briefly to read. ✅
- **Sparse PDT:** a server need only tag `PROGRAM-DATE-TIME` once (or per discontinuity), so
  `parseMediaPlaylist` carries it forward by summing `EXTINF`, resetting at `EXT-X-DISCONTINUITY`
  (else later segments are dropped for lack of a tag → subtitles vanish after one segment).

### Parser hardening (`webvtt.ts`)
- **Block-aware** — classifies each block (separated by blank lines) before looking for a cue, so a
  `-->` inside a `NOTE`/`STYLE`/`REGION` block can't become a phantom caption. Handles the optional
  cue-identifier line.
- **Strict timestamps** — `^(?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3})$`; comma-decimals, scientific/hex
  notation and out-of-range fields parse to NaN (cue dropped) rather than silently mistimed.
- **Whitespace-tolerant attribute parsing** in the rendition parsers (`[:,]\s*KEY="…"`) so a packager's
  `, NAME="…"` spacing doesn't drop the value (and the rendition).

---

## 4. Spec-edge handling, known limitations & diagnostics

### Handled
- **fMP4/IMSC (`EXT-X-MAP`) and encrypted (`EXT-X-KEY`) renditions** can't be text-parsed — detected in
  `parseMediaPlaylist`, logged, and self-rendering stops (instead of silently producing zero cues).

### Known limitations (with their log/visual fingerprint)
| Area | Limitation | Fingerprint |
|---|---|---|
| **Discontinuity** | One slope-1 wall↔media line; cues after an ad-splice `EXT-X-DISCONTINUITY` can misalign (carry-forward *stops* there, but a new-domain relative anchor may skew). | A chunk (often an ad break) is offset, rest correct. |
| **Per-channel feed residual** | The reconstructed `startDate` aligns the two timelines, but a genuine publish-time offset between the subtitle and video feeds leaves a small constant skew on some channels — playlist-only sync can't remove it. | Captions consistently a second or two early/late on one channel. |
| **No-PDT fallback skew** | When the *video* feed carries no `PROGRAM-DATE-TIME`, `startDate` can't be reconstructed; sync falls back to the live edge (`seekable.end ↔ newest subtitle PDT`), which the buffering hold-back biases. | Captions a few seconds early; `[Subs]` logs `using live-edge anchor`. |
| **X-TIMESTAMP-MAP MPEGTS** | Only `LOCAL` is read; PDT-anchoring covers the common case but a `LOCAL:0` + MPEGTS-offset packager with an unrelated PDT origin would desync. | Constant offset on one packager. |
| **GROUP-ID** | Renditions are collected across all groups; the variant's `SUBTITLES="grp"` association is ignored. One-group masters (the norm) are fine. | Wrong name/rendition on a multi-group master. |
| **EXT-X-BYTERANGE / EXT-X-DEFINE** | Byte-range segments are fetched whole; `{$var}` URIs aren't substituted. Rare for live WebVTT. | Wrong/duplicate cues, or a 404 → no captions. |
| **Cue settings** | `position/line/size/align/vertical` are dropped — we don't map WebVTT positioning onto `::cue`, so Blink draws every cue at its default bottom-centre. | Position/vertical-writing lost. |

### Diagnosing a "no subtitles" channel (from `[Subs]` logs in `ares-inspect`)
- `subtitles on: …` then nothing, with `cannot self-render this rendition — fmp4`/`encrypted` → an
  unsupported rendition (expected; see limitations).
- `no PROGRAM-DATE-TIME in the playlist — cannot anchor cue timing` → the *subtitle* playlist is
  PDT-less (VOD-style); not supported.
- `video playlist has no PROGRAM-DATE-TIME — using live-edge anchor …` → the *video* feed lacks PDT, so
  `startDate` can't be reconstructed; cues fall back to the live edge and may run a few seconds early.
- `subtitles refresh failed` (debug) → a segment fetch threw (404 — a redirect, `EXT-X-DEFINE`, or
  transient network).

---

## 5. The three in-manifest subtitle types

| Type | Manifest | Native handling |
|---|---|---|
| **WebVTT renditions** | `EXT-X-MEDIA:TYPE=SUBTITLES` (separate `.vtt` playlists) | Parsed + `X-TIMESTAMP-MAP`-aligned in the demux, but **not** exposed as a switchable `TextTrack` → we self-render (§3) |
| **CEA-608/708** | `EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS` (no URI; rides in the video ES) | Decoded by the platform caption compositor |
| **TTML / IMSC** | fMP4 segments, `application/ttml+xml` | Rendered by **imsc.js** to DOM, not GStreamer |

External sidecar SRT/WebVTT/ASS/etc. are also supported via the native `option.subtitle.uri` load
path but aren't part of HLS.

---

## 6. Native control surface — `luna://com.webos.media`

We **don't** use this surface for subtitles — it can't render ours. On-device ✅: `selectTrack
{type:"subtitle"}` returns **`false`** (`selectTrack` is audio-only on this firmware) and
`setSubtitleEnable:true` **succeeds but draws nothing**. These verbs drive the GStreamer caption
**compositor**, which only paints subs that ride in the pipeline (CEA-608/708, TTML/IMSC); our WebVTT
lives in **separate `.vtt` renditions** the demux parses but never routes into the compositor, so
"enable/select subtitle" governs a path our cues aren't on. Self-rendering through HTML5 `textTracks` (§3)
sidesteps it — it actually renders our WebVTT, runs the **same on-device and in the preview**, and gives
`::cue` styling; the one thing Luna uniquely offers, native-compositor position/style, we don't need.
(Audio is the opposite: there `selectTrack` *is* track-capable and is the same-language audio-collapse
fix — [`audio-track-selection.md`](audio-track-selection.md).)

| Action | Luna verb |
|---|---|
| Enable/disable | `setSubtitleEnable` |
| Pick track | `selectTrack` / `selectTrackByPreference` |
| Position / style | `setSubtitlePosition`, `setSubtitleCharacterColor`/`Font`/`FontSize`/… |
| Load-time | `option.subtitle.{languageCode, show, uri, subtitleRedirect}` |

---

*Conventions: **✅ confirmed on device** marks facts verified on real hardware; **(standard)** marks
behaviour that holds in any Blink/MSE browser.*
