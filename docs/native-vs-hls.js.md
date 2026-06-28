# webOS playback engine: native `<video src>` vs hls.js (MSE)

Decision record from evaluating whether to play HLS on the TV through **hls.js (MSE)** instead of the
**native `<video src>`** pipeline. Findings below were verified on real hardware (webOS 10.3.1,
Blink 120) — or, for codecs the live streams don't exercise, read from the firmware binaries — not
assumed.

**Bottom line:** native is the only path that decodes **4K Dolby Vision + Atmos** (a hardware route MSE
can't reach), while hls.js is better on everything the app actually plays today (≤1080p live) — correct
audio, exact subtitle sync, ~600 fewer lines. The app stays native; full reasoning under **Net** below.

## The comparison

### Playback & codecs

`<video src=…m3u8>` runs GStreamer end-to-end; hls.js parses the manifest in JS and feeds samples to
**MSE** (`MediaSource`/`SourceBuffer`) inside Blink (`libcbe`), which still hands compressed frames to
the **same hardware decoders** — so "MSE" is **not** software decode, only the demux/ABR/manifest logic
moves to JavaScript. The top rows are measured on-device; the codec/feature rows below them are
by-capability (what each engine can decode at all, for things the live content doesn't exercise).

| Dimension | native `<video src>` (HW pipeline) | hls.js (MSE / Blink) |
|---|---|---|
| 1080p / SD **live** (the real content) | ✅ smooth | ✅ smooth |
| `[Player] stalled` events | spams them, but **cosmetic** — plays smooth | none |
| Video / audio decode | hardware | hardware (MSE feeds the same decoders) |
| 4K HEVC (SDR) | ✅ | ✅ |
| HDR10 / HLG | ✅ | ✅ |
| Dolby Vision + Atmos ≤1080p (profile 5) | ✅ (badge confirmed) | ✅ (badge confirmed)
| 4K Dolby Vision + Atmos (profile 5) | ✅ (badge confirmed) | ❌ — `MediaCapabilities` reports it unsupported (see below) |
| Dolby Vision — dual-layer (profile 7, BL+EL) | ✅ | ❌ — MSE can't feed two coordinated layers (rare in streaming) |
| Dolby Atmos codecs | ✅ (E-AC-3 JOC, AC-4) | E-AC-3 (`ec-3`) usually ✅; AC-4 — probe `isTypeSupported('audio/mp4; codecs="ac-4"')` |
| In-band TS captions (CEA-608/708, DVB-sub) | ✅ native subtitle compositor | ❌ — need out-of-band WebVTT via `<track>` |
| DRM | EME (Widevine / PlayReady / ClearKey) | EME — same (encrypted HLS uses MSE/EME anyway) |

### Audio & subtitles

| Dimension | native `<video src>` | hls.js |
|---|---|---|
| **Audio-track selection** (same-language renditions) | ❌ **collapse bug** — picks the wrong rendition (plays *audio description* when you select the main track); unfixable at the HTML5 `audioTracks` layer | ✅ all renditions correct (hls.js demuxes them) |
| Subtitle rendering | Blink `::cue` (entities + `<c.class>` speaker colors work) | Blink `::cue` — **identical** (our injected `VTTCue`s render the same way) |
| Subtitle sync | ✅ live-edge anchor — approximate but **matches the audio** on-device | ✅ exact (hls.js owns video+subs) |
| Subtitle robustness | self-render: must handle feed-divergence, sliding windows, X-TIMESTAMP-MAP, fMP4/encrypted detection itself | hls.js handles it all |

### Resources & code

| Dimension | native `<video src>` | hls.js |
|---|---|---|
| Total system CPU @1080p (30s avg) | **~10%** | ~14% |
| Renderer CPU / JS heap | flat / **~2.9 MB** | bursty / ~26 MB |
| Resolution (real ≤1080p content) | up to panel | up to panel |
| Engine-specific code | **+~600 lines** (`HlsSubtitles` + `webvtt.ts` + audio-collapse workaround + native branches) | **−~600 lines** (hls.js owns subs & audio) |

## CPU & thermal cost of the hls.js path

The heavy consumer — HEVC/4K/HDR **decode — runs on the same hardware decoder either way**, so switching
engines doesn't change the dominant power/heat draw (panel + SoC video pipeline). hls.js only adds load
on the **general-purpose ARM cores** (shared with Blink + the app UI), and that load is dominated by
**transmuxing**:

- **MPEG-TS HLS (most IPTV)** → hls.js demuxes TS and remuxes to fMP4 **in JS for every segment** — the
  real, continuous CPU cost. Add AES-128/SAMPLE-AES decrypt if encrypted, plus live manifest reloads. It
  runs in a Web Worker (`enableWorker`), so it won't freeze the UI thread but still burns a core.
- **fMP4 / CMAF HLS** → no transmux; hls.js mostly just `appendBuffer`s — close to native CPU-wise.

Practical read:

- **Temperature:** the extra app-core load is small next to the panel/decoder, so it's unlikely to
  *meaningfully* raise the set's temperature.
- **The real risk is CPU saturation, not heat** — at high bitrate the SoC may not keep up with JS
  transmux, producing **dropped frames / audio glitches / buffering** rather than overheating.
- Mitigations: prefer fMP4/CMAF variants when available (no transmux); keep `maxBufferLength` /
  `backBufferLength` modest; don't run heavy UI animation while a high-bitrate stream is transmuxing.

## Why hls.js can't do 4K Dolby Vision + Atmos

Both codecs pass the cheap check individually — `isTypeSupported('video/mp4; codecs="dvh1.05.06"')` →
`true`, `…"ec-3"` → `true`. But hls.js doesn't stop there. In
`mediacapabilities-helper.ts → requiresMediaCapabilitiesDecodingInfo()`, a level is escalated to the
**`MediaCapabilities.decodingInfo()`** API if it is any of:

- HEVC (`dvh1`/`dvhe` are HEVC-based),
- HDR / PQ,
- larger than 1920×1088,
- above 30fps, or
- high-bitrate.

Unlike `isTypeSupported` (which only sees the codec fourcc), `decodingInfo()` is **resolution-,
framerate-, HDR-, and channel-aware**.

The 4K DV variant (`3840×2160 @59.94fps, PQ, dvh1.05.06 + ec-3 16/JOC`) trips every trigger, and the
TV's `decodingInfo()` returns **`supported: false`** — so hls.js drops the level (its `levels` array
ends up with the 1080p variant only). The 1080p DV config returns `true` and is kept.

> **✅ Confirmed on-device (webOS 10.3.1), both directions.** On **native**, the same 4K DV+Atmos
> stream plays with the Dolby Vision **and** Atmos badges on the TV. On **hls.js**, the
> `decodingInfo()` query below for that config returns `supported: false`, so hls.js drops to 1080p
> (1080p DV+Atmos returns `true` and plays with the badge). Source analysis and device agree exactly:
> native's hardware pipeline decodes 4K DV+Atmos; the browser MSE path can't.

So this is **the TV honestly reporting its browser-MSE decode ceiling** — a real hardware limit, not a
hls.js bug. It isn't a bandwidth limit (`bandwidthEstimate` was ~198 Mbps) or anything tunable
(`capLevelToPlayerSize` was already `false`, and there's no 4K level to force). The native pipeline
decodes 4K DV+Atmos in hardware, so it isn't bound by what MSE exposes.

One red herring to ignore: `isTypeSupported('…"dvh1.05.06,ec-3"')` → `false`. That asks about a single
**muxed** buffer (which fails for the 1080p variant too), but hls.js uses separate video/audio
SourceBuffers — so it doesn't apply.

## Aside: native chokes on the Apple multi-codec sample (not a real-content issue)

The Apple `adv_dv_atmos` test master[^dv-apple] is a
deliberate **"everything-in-one-ladder" torture test**: a single ABR ladder mixing **three video codec
families** — `avc1` (H.264 SDR ×23), `hvc1` (HEVC SDR ×62), `dvh1` (Dolby Vision PQ ×31) — **and** both
**SDR and HDR (PQ)** ranges, in fMP4/CMAF.

On **native `<video src>`** it fails with `MEDIA_ERR_DECODE` (`code: 3`) a couple of seconds in
(`loadedmetadata 480x270` → `playing` → error) and the app zaps away.

The firmware has dedicated machinery for switching codecs and flipping the panel's HDR range —
`gst_decproxy_switch_decoder` hot-swaps the decoder on a caps change, `lxvideodec` does `codec changed
from [%s] to [%s]` → `gst_lx_videodec_reopen`, and the sink has an `hdr-type` switch
(`change hdr type to SDR …`). What the firmware *does* show:

- **The decoder is lazily deployed and resource-gated.** `decproxy` runs a *fake* decoder until it
  acquires a HW handle, then deploys the real one "by resource permissions" — chosen from the **first**
  caps it sees (here: the low **H.264 / SDR** 480p rung).
- **Climbing this ladder forces a mid-stream hot-swap to a much heavier decoder** (H.264/SDR → 4K
  HEVC/DV + PQ): re-acquire a different HW resource, `reopen` the codec, flip the panel range — all on a
  variant boundary with no `EXT-X-DISCONTINUITY`. That swap is where it empirically decode-errors
  (`lxvideodec` posts `Not Support Stream …` → `GST_STREAM_ERROR_DECODE` → `MEDIA_ERR_DECODE`).
- **Single-codec / single-range masters never hot-swap** — they deploy the right decoder from the first
  caps, which is why pure-`dvh1` 4K DV+Atmos plays fine.

So it's **not an inability to switch codecs** — it's the resource-gated *mid-stream* swap to a heavier
codec/range failing on this deliberately-mixed ladder. The exact failing step (resource re-acquire vs.
reopen vs. boundary handling) would need an on-device pipeline-log capture to pin; the firmware names
the candidate failure points but not which one fires here.

This is **specific to the multi-everything test asset, not a real-content problem**:
- The **pure-DV streams** (single codec `dvh1`, single PQ range) play fine on native — that's how 4K
  DV+Atmos was confirmed (✅ on-device); the two masters are tabled below.
- **hls.js tolerated** it: via MSE it filters to a compatible codec subset (dropping the 4K DV variant
  it can't decode) and stays within it, so it just downgraded to 1080p instead of hard-failing.
- **Real IPTV channels are single-codec / single-range**, so none of them hit this.

(A minor robustness point in hls.js's favor — graceful degradation where native hard-fails — but on a
malformed-for-purpose ladder no real stream produces.)

**Pure DV+Atmos masters used.** Single-codec Profile 5, so native plays them. Both verified live, frame
rates read from the manifests, and **4K resolution ✅ confirmed on-device** (`video.videoWidth`×`video.videoHeight`):

| Test master | Dolby Vision | Atmos | Max res / fps |
|---|---|---|---|
| Dolby developer[^dv-cf] | `dvh1.05.06` (Profile 5, PQ) | `ec-3`, 16/JOC | 3840×2160 @ 59.94 |
| Dolby OTT[^dv-dolby] | `dvh1.05.0x` (Profile 5, PQ) | `ec-3`, 16/JOC (+ stereo `mp4a` fallback) | 3840×2160 @ 30 |

## Net

- **For the content that actually runs (≤1080p live):** both engines play it; **hls.js additionally
  fixes the audio-collapse bug** (a real, user-facing defect on native) and gives exact subtitle sync,
  with ~600 fewer lines. Costs +4% CPU and ~9× JS heap (both modest).
- **For 4K Dolby Vision + Atmos:** **native only** — a hard, MediaCapabilities-confirmed MSE limit.

The remaining choice is a **product call**, not a technical one: weight *"4K Dolby Vision on the OLED"*
(native, but still carrying the audio-collapse bug) against *"correct audio + exact subs +
simpler code on the ≤1080p content you run"* (hls.js, DV capped at 1080p).

## Reproduce on-device

```js
// hls.js level ladder (run while a stream plays; __hls has to be exposed beforehand)
__hls.levels.map((l,i) => `${i}: ${l.width}x${l.height} @${(l.bitrate/1e6).toFixed(1)}Mbps`);

// the decode-capability answer that drops 4K DV+Atmos
navigator.mediaCapabilities.decodingInfo({ type:'media-source',
  video:{ contentType:'video/mp4; codecs="dvh1.05.06"', width:3840, height:2160, framerate:59.94, bitrate:23822059, transferFunction:'pq' },
  audio:{ contentType:'audio/mp4; codecs="ec-3"', channels:'16', samplerate:48000, bitrate:768000 }
}).then(r => console.log('4K DV+Atmos supported →', r.supported));   // false
```

[^dv-apple]: Apple advanced HLS example (Dolby Vision + Atmos) — https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8
[^dv-cf]: Dolby developer sample (DV Profile 5 + Atmos, 4K 59.94fps) — https://media.developer.dolby.com/DolbyVision_Atmos/profile5_HLS/master.m3u8
[^dv-dolby]: Dolby OTT browser test kit (DV Profile 5 + Atmos, 4K 30fps) — https://ott.dolby.com/browser_test_kit/clear/p5/30/master.m3u8
