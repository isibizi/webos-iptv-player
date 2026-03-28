import type { Channel, ParsedPlaylist } from '../types';

export function parseM3U(text: string): ParsedPlaylist {
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

  return {
    channels,
    groups: Array.from(groupSet),
    epgUrl,
  };
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
