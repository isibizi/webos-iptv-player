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
}

export interface PlaylistEntry {
  name: string;
  url: string;
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
