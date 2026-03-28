# webOS IPTV Player

An IPTV player for LG webOS TVs. Supports M3U playlists, XMLTV programme guides, and catch-up/timeshift playback.

![icon](assets/icon.svg)

## Preview

![preview](preview.png)

## Features

- **M3U Playlist Support** — Load multiple M3U/M3U8 playlists with auto-deduplication
- **Electronic Programme Guide (EPG)** — Full-screen grid with 7-day navigation, programme details, and day selector
- **Catch-up / Timeshift** — Play past programmes using `catchup-source` URL templates from M3U
- **Channel Sidebar** — Quick channel switching overlay with current programme info and auto-scrolling text
- **Magic Remote Support** — Pointer-driven navigation for sidebar, menu, and channel selection
- **Spatial Navigation** — Full D-pad/remote navigation across all views
- **On-Screen Display** — Channel info bar with programme title, progress timeline, and timestamps
- **Favorites** — Mark and filter favorite channels
- **Auto-play** — Resume last watched channel on startup
- **Desktop Preview** — Browser-based preview with HLS.js and mpegts.js fallbacks

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

## Remote Control Mapping

| Key | Player | Channel List | EPG |
|-----|--------|-------------|-----|
| Up/Down | Channel +/- | Navigate | Navigate |
| Left | Open sidebar | — | Previous day |
| Right | Open menu | — | Next day |
| OK/Enter | Toggle OSD | Select channel | Play programme |
| Back | Stop & return | Exit app | Close guide |
| Red | Open EPG | Open EPG | — |
| Blue | Open settings | Open settings | Close guide |
| Yellow | Show OSD | — | — |
| Green | Toggle favorite | — | — |
| Ch +/- | Channel +/- | Page up/down | Jump 10 channels |
| 0-9 | Direct channel entry | Direct channel entry | — |
