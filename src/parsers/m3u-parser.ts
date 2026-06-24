import type { Channel, ParsedPlaylist } from '../types';

export function parseM3U(text: string, sourceUrl = ''): ParsedPlaylist {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  const groupSet = new Set<string>();
  let current: Channel | null = null;
  let epgUrl = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#EXTM3U')) {
      epgUrl = extractAttr(trimmed, 'url-tvg') || extractAttr(trimmed, 'x-tvg-url');
      continue;
    }

    if (trimmed.startsWith('#EXTINF:')) {
      current = parseExtInf(trimmed);
    } else if (trimmed.startsWith('#EXTGRP:') && current) {
      current.group = trimmed.slice(8).trim();
    } else if (trimmed.startsWith('#EXTVLCOPT:') && current) {
      const [key, ...valParts] = trimmed.slice(11).split('=');
      if (!current.extras) current.extras = {};
      current.extras[key.trim()] = valParts.join('=').trim();
    } else if (trimmed.startsWith('#KODIPROP:') && current) {
      const [key, ...valParts] = trimmed.slice(10).split('=');
      if (!current.extras) current.extras = {};
      current.extras[key.trim()] = valParts.join('=').trim();
    } else if (!trimmed.startsWith('#') && current) {
      current.url = trimmed;
      if (current.group) groupSet.add(current.group);
      channels.push(current);
      current = null;
    }
  }

  // An HLS stream playlist (master OR media) carries #EXT-X-* tags and is NOT a
  // channel list: a master parses to nothing, while a media playlist parses each
  // *segment* as a bogus "channel". When a stream URL is configured as a playlist,
  // wrap the source URL as a single channel so it plays — discarding any segment
  // entries — instead of an empty or junk list.
  if (sourceUrl && /(^|\n)#EXT-X-/.test(text)) {
    return {
      channels: [{
        id: '', name: nameFromUrl(sourceUrl), logo: '', group: 'Uncategorized',
        url: sourceUrl, extras: null, playlist: '', catchup: '', catchupSource: '', catchupDays: 0,
      }],
      groups: ['Uncategorized'],
      epgUrl,
    };
  }

  return {
    channels,
    groups: Array.from(groupSet),
    epgUrl,
  };
}

/** Derive a display name from a stream URL: its filename without extension,
 *  falling back to the host, then a generic label. */
function nameFromUrl(url: string): string {
  try {
    const { pathname, hostname } = new URL(url);
    const base = pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(base.replace(/\.[^./]+$/, '')) || hostname || 'Stream';
  } catch {
    return 'Stream';
  }
}

function parseExtInf(line: string): Channel {
  const commaIdx = line.lastIndexOf(',');
  const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : 'Unknown';
  const attrStr = commaIdx >= 0 ? line.slice(8, commaIdx) : line.slice(8);

  return {
    id: extractAttr(attrStr, 'tvg-id'),
    name: extractAttr(attrStr, 'tvg-name') || name,
    logo: extractAttr(attrStr, 'tvg-logo'),
    group: extractAttr(attrStr, 'group-title') || 'Uncategorized',
    url: '',
    extras: null,
    playlist: '',
    catchup: extractAttr(attrStr, 'catchup'),
    catchupSource: extractAttr(attrStr, 'catchup-source'),
    catchupDays: parseInt(extractAttr(attrStr, 'catchup-days') || '0', 10) || 0,
  };
}

function extractAttr(str: string, key: string): string {
  const regex = new RegExp(key + '="([^"]*)"', 'i');
  const match = str.match(regex);
  return match ? match[1] : '';
}
