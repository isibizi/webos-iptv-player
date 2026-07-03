# webOS IPTV Player

An IPTV player for LG webOS TVs. Supports M3U playlists, XMLTV program guides, and catch-up/timeshift playback.

![icon](assets/icon.svg)

## Preview

| Channel list | Channel info |
| --- | --- |
| ![Channel list](https://github.com/user-attachments/assets/b9ae3b70-9ae0-42ad-acec-6c086d506826) | ![Channel info](https://github.com/user-attachments/assets/9b77591d-ac4f-4746-bf69-5d4527f6ce8c) |

| Playback overlays | Subtitles |
| --- | --- |
| ![Playback overlays](https://github.com/user-attachments/assets/f48d7a56-33d1-4d5b-ab44-dbcfa1769930) | ![Subtitles](https://github.com/user-attachments/assets/5d1fab57-1087-414b-9a20-f900589eac4a) |

| Program guide | Settings |
| --- | --- |
| ![Program guide](https://github.com/user-attachments/assets/887acb03-a7a6-4a12-986e-f1f9054c6d6c) | ![Settings](https://github.com/user-attachments/assets/6dba6720-9ff9-4fd0-8dab-50484c2eafaf) |

## Features

- **M3U Playlist Support** — Load multiple M3U/M3U8 playlists with auto-deduplication
- **LAN M3U Upload** — Drop `.m3u` files onto the TV from any phone/laptop on the same network via a QR-scannable upload page; new playlists appear in Settings within milliseconds (push, not polling). See [`upload-service/README.md`](upload-service/README.md) for details.
- **Electronic Program Guide (EPG)** — Three-pane layout (channels / date bar / programs), date range auto-derived from EPG data, with IndexedDB caching for instant reopen
- **Catch-up / Timeshift** — Play past programs using `catchup-source` URL templates from M3U; seek within a program by jumping ±30s with Left/Right (while the OSD is showing) or pointing at the seek bar with the Magic Remote
- **Channel Search** — Find channels by name from both the channel list and the player sidebar; focus the search box and press OK to type. Search spans all groups and is scoped to the selected playlist tab
- **Channel Sidebar** — Quick channel switching overlay with current program info and auto-scrolling text
- **Group Icons** — Channel groups show genre icons (sports, news, kids, movies, music, …) auto-matched from the group title across many languages, with a generic fallback for unmatched groups
- **Magic Remote Support** — Pointer-driven navigation for sidebar, menu, and channel selection
- **Spatial Navigation** — Full D-pad/remote navigation across all views
- **On-Screen Display** — Channel info bar with program title, progress timeline, and timestamps, plus a live stream-info readout (resolution, HDR, frame rate, video/audio codec, audio channels, and subtitles) detected from the playing stream
- **Favorites** — Mark and filter favorite channels
- **Auto-play** — Resume last watched channel on startup
- **HDR & Dolby passthrough (native pipeline)** — On the TV, playback hands the stream straight to the native `<video>` element instead of a JavaScript player, so the set's hardware decoder handles it end-to-end. HDR10, HLG, Dolby Vision®, and Dolby Atmos® therefore pass through untouched whenever the stream carries them and your TV supports them — the app neither adds nor strips them; it gets this for free by staying out of the media path. (Desktop preview uses software HLS/TS players and won't.) See [`docs/native-vs-hls.js.md`](docs/native-vs-hls.js.md)
- **Audio tracks** — Pick an audio track from the player menu; your choice is remembered per channel and re-matched by name or language on future streams, with track names read from the stream's master playlist
- **Subtitles** — Pick a subtitle track from the player menu; your choice — including an explicit *off* — is remembered per channel. On the TV the app self-renders in-manifest WebVTT subtitles (webOS won't expose them as selectable tracks), time-synced to the video and honoring each cue's on-screen position and speaker colors, with track names read from the stream
- **Desktop Preview** — Browser-based preview with HLS.js and mpegts.js fallbacks

## Supported webOS versions

The app runs on **webOS 5.0 (2020) and newer**. Its baseline is the Chromium 68
engine on webOS 5; every later release ships a newer Chromium, so the app is
forward-compatible. Features only newer engines support natively (flex `gap`,
`backdrop-filter`, …) get feature-detected fallbacks on the older ones.

| webOS version | Released | Chromium engine | Supported |
| --- | --- | --- | --- |
| webOS 5.0 | 2020 | 68 | ✅ (minimum) |
| webOS 6.0 | 2021 | 79 | ✅ |
| webOS 22 | 2022 | 87 | ✅ |
| webOS 23 | 2023 | 94 | ✅ |
| webOS 24 | 2024 | 108 | ✅ |
| webOS 25 | 2025 | 120 | ✅ |

webOS 4.x and older (Chromium 53 and earlier) lack JavaScript and CSS features
the app relies on, and are not supported.

## Install on your TV

1. **Download the app.** On your computer, open the
   [Releases page](https://github.com/lennylxx/webos-iptv-player/releases/latest)
   and download the latest `.ipk` file.

2. **Install the webOS CLI tools.** Install [Node.js](https://nodejs.org/) (v18+), then run:

   ```bash
   npm install -g @webos-tools/cli
   ```

3. **Turn on Developer Mode on the TV.**
   - Create a free account at the [LG webOS Developer site](https://webostv.developer.lge.com/).
   - On the TV, open the **LG Content Store**, search for **Developer Mode**, then
     install and open it.
   - Sign in with your LG developer account and switch **Dev Mode Status** to **ON**.
     The TV restarts. Note the **IP address** and **passphrase** the app shows.

4. **Register your TV.** Add it as a device named `tv` (replace the IP with your TV's):

   ```bash
   ares-setup-device --add tv -i "username=prisoner" -i "host=127.0.0.1" -i "port=9922"
   ```

   Then fetch the device key, entering the **passphrase** from the Developer Mode app when prompted:

   ```bash
   ares-novacom --device tv --getkey
   ```

5. **Install the app.**

   ```bash
   ares-install --device tv ./com.lennylxx.iptv_<version>_all.ipk
   ```

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [webOS CLI tools](https://webostv.developer.lge.com/develop/tools/cli-installation) (`ares-*` commands)

## Setup

```bash
npm install
```

## Build

```bash
./build.sh
```

## Build & Install to TV

```bash
./build.sh --install [device-name]
```

If no device name is given, the default device from `ares-setup-device` is used.

## Preview in Browser

```bash
npm run preview
```

Opens at http://localhost:3000. Video playback uses HLS.js/mpegts.js on desktop since browsers lack native TS/HLS support.

## Settings

Open with the **Blue** key or click the gear icon in the channel list. Sections:

- **Playlists** — add, edit, or remove M3U URLs. Re-applied on Save.
- **Upload Playlist** — QR code + LAN URL on the left, list of currently uploaded playlists on the right. Scan the QR from a phone/laptop on the same network to upload `.m3u` files; they appear in this list within milliseconds via Luna push.
- **EPG (Electronic Program Guide)** — set the XMLTV URL (also auto-detected from `x-tvg-url` in M3U).
- **Display** — *Program time zone*: show EPG times in your **Device** time zone (default), or the **Feed**'s own time zone (auto-detected from the EPG feed when it loads).
- **Playback** — toggle auto-play (resume last watched channel on launch).
- **Data Management** — *Refresh All Data* re-fetches playlists and EPG; *Clear Cache* drops the cached playlist + EPG.
- **Save & Apply** reloads channels from the new sources. **Cancel** discards edits.

## Remote Control Mapping

| Key | Player | Channel List | EPG |
|-----|--------|-------------|-----|
| Up/Down | Channel +/- | Navigate | Navigate within pane |
| Left | Open sidebar / seek −30s (catch-up) | — | Back to channels / previous day |
| Right | Open menu / seek +30s (catch-up) | — | To programs / next day |
| OK/Enter | Toggle OSD | Select channel / Open settings (gear) | Play channel / program (catch-up if past) |
| Back | Stop & return | Exit app (press twice) | Close guide |
| Red | Open EPG | Open EPG | — |
| Blue | Open settings | Open settings | Close guide |
| Yellow | Show OSD | — | — |
| Green | Toggle favorite (in sidebar/menu) | Toggle favorite (on focused channel) | Jump to today |
| Ch +/- | Channel +/- | Page up/down | Jump 10 channels |
| 0-9 | Direct channel entry | Direct channel entry | — |
