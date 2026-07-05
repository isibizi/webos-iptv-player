export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  extras: Record<string, string> | null;
  /** The stable `id` of every configured playlist this channel appears in (dedup
   *  keeps one channel object, but it can belong to several overlapping playlists). */
  playlistIds: string[];
  catchup: string;
  catchupSource: string;
  catchupDays: number;
}

/** One playlist tab. `id` is the configured playlist's stable id (so two
 *  playlists sharing a name stay distinct); `name` is the display label. */
export interface PlaylistTab {
  id: string;
  name: string;
}

export interface ParsedPlaylist {
  channels: Channel[];
  groups: string[];
  epgUrl: string;
}

export interface Programme {
  start: Date;
  stop: Date;
  title: string;
  description: string;
  category: string;
  icon: string;
}

export interface EpgChannel {
  name: string;
  icon: string;
}

export interface ParsedEpg {
  channels: Record<string, EpgChannel>;
  programmes: Record<string, Programme[]>;
  /** Minutes east of UTC declared by the feed's timestamps (e.g. +0100 -> 60), or null if none carry an offset. */
  tzOffsetMinutes?: number | null;
}

export interface PlaylistEntry {
  /** Stable identity assigned once at creation. Keys channel membership and the
   *  playlist tabs, so deleting/reordering/renaming never shifts the others and
   *  two playlists sharing a URL or name stay independent. StorageService
   *  backfills it for any legacy entry read from storage. */
  id: string;
  name: string;
  /** For 'xtream' entries this is the normalized portal base (`http://host:port`);
   *  the get.php/xmltv.php URLs are derived from it + credentials at load time. */
  url: string;
  /** 'upload' entries are auto-managed by the local upload service; 'xtream' is an
   *  Xtream Codes account; absent/'url' are user-entered M3U URLs. */
  source?: 'upload' | 'url' | 'xtream';
  /** Credentials for an 'xtream' entry. */
  xtream?: { username: string; password: string };
  /** Channel count, populated for 'upload' entries by reconcile() from UploadMeta. */
  count?: number;
}

export interface CatchupInfo {
  start: number;
  end: number;
  title: string;
  description: string;
  icon: string;
}

/** A user-set reminder for an upcoming program. Keyed by channelKey + startMs. */
export interface Reminder {
  channelKey: string;
  channelName: string;
  title: string;
  startMs: number;
  stopMs: number;
  /** Set once the user answers the in-app OK/Cancel prompt, so it isn't shown again. */
  answered?: boolean;
}

/** Which timezone EPG times are displayed in: the device's, or the feed's. */
export type TzMode = 'device' | 'feed';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'select' | 'back'
  | 'red' | 'green' | 'yellow' | 'blue'
  | 'channel_up' | 'channel_down'
  | 'play' | 'pause' | 'stop'
  | 'rewind' | 'fast_forward'
  | 'number';

export interface NumberEvent {
  number: number;
}

/** A selectable audio track exposed by the active player (the picker's view model). */
export interface AudioTrackOption {
  index: number;
  label: string;
  active: boolean;
  /** False = shown but not switchable — a same-language rendition webOS collapsed
   *  out of the native list. Defaults to switchable when absent. */
  available?: boolean;
}

/** Normalized audio rendition, unified across the hls.js list and the native
 *  HTMLMediaElement.audioTracks list so one selection routine serves both. */
export interface AudioOption {
  index: number;
  name: string;
  lang: string;
  isDefault: boolean;
  active: boolean;
}

/** A remembered audio-track choice, matched against future streams by name then language. */
export interface AudioPref {
  name: string;
  lang: string;
}

/** An audio rendition declared in an HLS master playlist (EXT-X-MEDIA:TYPE=AUDIO). */
export interface ManifestAudio {
  name: string;
  lang: string;
  isDefault: boolean;
}

/** A selectable subtitle track for the picker. `index` -1 is the synthetic "Off"
 *  row the menu prepends; real tracks index into the player's track list. */
export interface SubtitleTrackOption {
  index: number;
  label: string;
  active: boolean;
  /** False = shown but not switchable — a rendition the platform didn't expose
   *  as a native textTrack. Defaults to switchable when absent. */
  available?: boolean;
}

/** Normalized subtitle rendition, unified across the hls.js list and the native
 *  HTMLMediaElement.textTracks list so one selection routine serves both. */
export interface SubtitleOption {
  index: number;
  name: string;
  lang: string;
  isDefault: boolean;
  isForced: boolean;
  active: boolean;
}

/** A remembered subtitle choice. `off` records an explicit "no subtitles" so it
 *  survives re-tunes; `cc` records the in-band CEA-608/708 toggle (drawn by the
 *  native compositor, not a track); otherwise matched against future streams by
 *  name then language. */
export interface SubtitlePref {
  off: boolean;
  name: string;
  lang: string;
  cc?: boolean;
}

/** A subtitle rendition declared in an HLS master playlist (EXT-X-MEDIA:TYPE=SUBTITLES). */
export interface ManifestSubtitle {
  name: string;
  lang: string;
  isDefault: boolean;
  isForced: boolean;
}

/** An in-band closed-caption track declared in an HLS master
 *  (EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS) — CEA-608 (INSTREAM-ID CC1-4) or
 *  CEA-708 (SERVICE1-63). These ride inside the video ES; webOS draws them via
 *  the native compositor (setSubtitleEnable), never as a textTrack. */
export interface ManifestClosedCaption {
  name: string;
  lang: string;
  instreamId: string;
  isDefault: boolean;
}
