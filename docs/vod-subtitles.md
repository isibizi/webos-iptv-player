# VOD subtitles (Xtream movies & episodes)

How this app handles subtitles for **VOD** — Xtream movies and series episodes, played as
progressive `<video src>` (mp4/mkv) with `this.hls` null. Two independent sources feed one
picker: subtitles muxed **in the container**, and **sidecar** files listed by the panel. Sidecars
render one of two ways by format: SRT/WebVTT as native `<track>`s, ASS/SSA through an `assjs`
overlay.

| | |
|---|---|
| **Code** | `src/components/player.ts`, `src/services/vod-subtitles.ts`, `src/services/ass-subtitles.ts`, `src/utils/srt.ts`, `src/services/xtream-client.ts`, `src/utils/subtitle-tracks.ts` |
| **Live/HLS counterpart** | [`hls-subtitles.md`](hls-subtitles.md) |
| **Audio counterpart** | [`audio-track-selection.md`](audio-track-selection.md) |

## TL;DR

- In-container and SRT/WebVTT sidecars surface as native `video.textTracks`, so one path drives
  them: `nativeSubtitleOptions` enumerates the `subtitles`/`captions` tracks for the picker, and
  a pick sets `textTracks[i].mode` (`'showing'` / `'disabled'`; `-1` = all off).
- ASS/SSA sidecars can't be a native `<track>`; they join the **same picker** as synthetic
  options at `ASS_SUBTITLE_BASE + i` and are drawn by `assjs` into an `#ass-overlay`.
- **Off by default** unless a saved pick applies. The choice is **remembered per item** under a
  `vod:<account>:<kind>:<itemId>` key — the same key the VOD audio memory uses.
- Blink draws the native-track cues (like the HLS self-render path), so `::cue` styling applies
  on-device; `assjs` draws ASS cues as HTML/CSS in the overlay.

## In-container subtitles

Progressive VOD exposes any subtitle streams muxed into the mp4/mkv as real
`video.textTracks`, so no self-render is needed. `subtitleOptions()` branches on `this.vod` to
`nativeSubtitleOptions(videoEl.textTracks)`; `applySubtitleChoice()` toggles the chosen
track's `mode`. The saved pick (or explicit *off*) is re-applied from `applyNativeSubtitleSelection`
once the tracks arrive (`loadedmetadata` / `addtrack`).

## Sidecar subtitles

Xtream `get_vod_info` / `get_series_info` may list external subtitle files under
`info.subtitles[]` (usually `.srt`, sometimes `.ass`/`.ssa`). `xtream-client`'s `parseSubtitles`
keeps only entries with an **absolute http(s) URL** — panels vary, and a filename we can't
resolve is useless (and unsafe to guess at). These ride the `VodPlayback` into the player, which
splits them by extension (`isAssSidecar`): SRT/WebVTT go to `VodSubtitles`, ASS/SSA to
`AssSubtitles`.

### SRT / WebVTT — native `<track>`s

On play, `VodSubtitles.attach` creates one empty `<track>` per SRT/WebVTT sidecar on the
`<video>`, so it lists in the picker via the same `nativeSubtitleOptions` path as in-container
tracks. The cues are fetched, converted and parsed the **first time the track is shown**
(`VodSubtitles.ensureLoaded`): a `WEBVTT` file is parsed directly, anything else is treated as
SRT and converted first (`srtToVtt` / `parseSubtitleFile` in `src/utils/srt.ts` — SRT differs only
in the `,mmm` fraction separator and the missing header; its numeric sequence lines are valid
WebVTT cue identifiers).

Because the `<track>`s are `<video>` children, the player's `innerHTML` reset between streams
(`loadStream` / `stop`) removes them and their tracks — nothing leaks from one item into the next.

### ASS / SSA — `assjs` overlay

ASS/SSA carry positioning, styling and karaoke a `<track>` can't express, so they're rendered by
[`assjs`](https://github.com/weizhenye/ass) (MIT) — a DOM/CSS ASS renderer. DOM/CSS was chosen
over libass/WASM so **the browser does font fallback** (the TV's system fonts, incl. CJK, with
**no bundled fonts**) and it stays small (tens of KB) and degrades feature-by-feature on old
browsers rather than breaking — so the core renders on the Chromium-68 floor (webOS 5), while
newer TVs get the advanced tags. `assjs` is loaded with a **lazy dynamic `import('assjs')`** that
esbuild keeps in a deferred `__esm` wrapper, so a TV that never plays ASS never runs it; an import
or fetch failure logs a warning and leaves subtitles off (never a crash or blank screen).

`AssSubtitles` (`src/services/ass-subtitles.ts`) owns the `assjs` instance and an `#ass-overlay`
`<div>` positioned over the video plane (`pointer-events:none`, below the OSD/menu). Since ASS
sidecars aren't native tracks, `subtitleOptions()` appends a synthetic `SubtitleOption` per ASS
sidecar at index `ASS_SUBTITLE_BASE + i` (a high base, disjoint from real textTracks indices and
the `-1` Off / `-2` CC sentinels). `applySubtitleChoice` routes by range: an ASS index shows that
sidecar (`AssSubtitles.show(i)`) and disables every native track; a native index or Off calls
`AssSubtitles.hide()` — **one path draws at a time**. A `gen` counter guards a race where a newer
selection/stop lands mid-fetch; `stop` calls `AssSubtitles.destroy()` to tear down the instance
and drop the overlay.

Memory is unchanged: an ASS pick is remembered by name/lang under the same
`vod:<account>:<kind>:<itemId>` key, and `chooseSubtitleIndex` matches it across all options
(native and ASS), so it restores like any other pick.

**Fetch:** the sidecar is a plain cross-origin GET of the panel-provided URL. It works on-device
(as the HLS subtitle-segment fetch does); the desktop preview is subject to CORS.
