# VOD subtitles (Xtream movies & episodes)

How this app handles subtitles for **VOD** — Xtream movies and series episodes, played as
progressive `<video src>` (mp4/mkv) with `this.hls` null. Two independent sources feed one
picker: subtitles muxed **in the container**, and **sidecar** files listed by the panel.

| | |
|---|---|
| **Code** | `src/components/player.ts`, `src/services/vod-subtitles.ts`, `src/utils/srt.ts`, `src/services/xtream-client.ts`, `src/utils/subtitle-tracks.ts` |
| **Live/HLS counterpart** | [`hls-subtitles.md`](hls-subtitles.md) |
| **Audio counterpart** | [`audio-track-selection.md`](audio-track-selection.md) |

## TL;DR

- Both sources surface as native `video.textTracks`, so one path drives them:
  `nativeSubtitleOptions` enumerates the `subtitles`/`captions` tracks for the picker, and a
  pick sets `textTracks[i].mode` (`'showing'` / `'disabled'`; `-1` = all off).
- **Off by default** unless a saved pick applies. The choice is **remembered per item** under a
  `vod:<account>:<kind>:<itemId>` key — the same key the VOD audio memory uses.
- Blink draws the cues (like the HLS self-render path), so `::cue` styling applies on-device.

## In-container subtitles

Progressive VOD exposes any subtitle streams muxed into the mp4/mkv as real
`video.textTracks`, so no self-render is needed. `subtitleOptions()` branches on `this.vod` to
`nativeSubtitleOptions(videoEl.textTracks)`; `applySubtitleChoice()` toggles the chosen
track's `mode`. The saved pick (or explicit *off*) is re-applied from `applyNativeSubtitleSelection`
once the tracks arrive (`loadedmetadata` / `addtrack`).

## Sidecar subtitles

Xtream `get_vod_info` / `get_series_info` may list external subtitle files under
`info.subtitles[]` (usually `.srt`). `xtream-client`'s `parseSubtitles` keeps only entries with
an **absolute http(s) URL** — panels vary, and a filename we can't resolve is useless (and unsafe
to guess at). These ride the `VodPlayback` into the player.

On play, `VodSubtitles.attach` creates one empty `<track>` per sidecar on the `<video>`, so it
lists in the picker via the same `nativeSubtitleOptions` path as in-container tracks. The cues
are fetched, converted and parsed the **first time the track is shown**
(`VodSubtitles.ensureLoaded`): a `WEBVTT` file is parsed directly, anything else is treated as
SRT and converted first (`srtToVtt` / `parseSubtitleFile` in `src/utils/srt.ts` — SRT differs only
in the `,mmm` fraction separator and the missing header; its numeric sequence lines are valid
WebVTT cue identifiers).

Because the `<track>`s are `<video>` children, the player's `innerHTML` reset between streams
(`loadStream` / `stop`) removes them and their tracks — nothing leaks from one item into the next.

**Format support:** SRT and WebVTT. Other formats (ASS/SSA, TTML, `.sub`, …) parse to zero cues
(an empty track), because they carry no SRT/VTT-style `-->` timing lines.

**Fetch:** the sidecar is a plain cross-origin GET of the panel-provided URL. It works on-device
(as the HLS subtitle-segment fetch does); the desktop preview is subject to CORS.
