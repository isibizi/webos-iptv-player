export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  extras: Record<string, string> | null;
  playlist: string;
  catchup: string;
  catchupSource: string;
  catchupDays: number;
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
  name: string;
  url: string;
  /** 'upload' entries are auto-managed by the local upload service; absent/'url' are user-entered. */
  source?: 'upload' | 'url';
  /** Channel count, populated for 'upload' entries by reconcile() from UploadMeta. */
  count?: number;
}

export interface CachedData<T> {
  data: T;
  timestamp: number;
}

export interface CatchupInfo {
  start: number;
  end: number;
  title: string;
  description: string;
  icon: string;
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
  | 'number';

export interface NumberEvent {
  number: number;
}

export interface ViewHandler {
  handleAction(action: Action, event?: NumberEvent): void;
}
