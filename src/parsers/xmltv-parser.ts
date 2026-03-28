import type { ParsedEpg, Programme, EpgChannel } from '../types';
import { parseXmltvDate } from '../utils/time';

export function parseXMLTV(xmlString: string): ParsedEpg {
  // Strip DOCTYPE to avoid DOMParser issues with external DTD references
  const cleaned = xmlString.replace(/<!DOCTYPE[^>]*>/i, '');
  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.error('[EPG] XML parse error:', parseError.textContent);
    return { channels: {}, programmes: {} };
  }
  const channels: Record<string, EpgChannel> = {};
  const programmes: Record<string, Programme[]> = {};

  for (const ch of doc.querySelectorAll('channel')) {
    const id = ch.getAttribute('id');
    if (!id) continue;
    const displayName = ch.querySelector('display-name');
    const icon = ch.querySelector('icon');
    channels[id] = {
      name: displayName?.textContent ?? id,
      icon: icon?.getAttribute('src') ?? '',
    };
  }

  const progElements = doc.querySelectorAll('programme');
  console.log(`[EPG] Parsed ${Object.keys(channels).length} channels, ${progElements.length} programme elements`);

  const now = Date.now();
  const maxTime = now + 7 * 24 * 60 * 60 * 1000; // 7 days ahead
  const minTime = now - 7 * 24 * 60 * 60 * 1000; // 7 days back (catchup)

  let skippedDate = 0;
  let skippedRange = 0;

  for (const prog of progElements) {
    const channelId = prog.getAttribute('channel');
    if (!channelId) continue;

    const start = parseXmltvDate(prog.getAttribute('start'));
    const stop = parseXmltvDate(prog.getAttribute('stop'));
    if (!start || !stop) {
      skippedDate++;
      continue;
    }
    if (stop.getTime() < minTime || start.getTime() > maxTime) {
      skippedRange++;
      continue;
    }

    const titleEl = prog.querySelector('title');
    const descEl = prog.querySelector('desc');
    const catEl = prog.querySelector('category');
    const iconEl = prog.querySelector('icon');

    if (!programmes[channelId]) programmes[channelId] = [];
    programmes[channelId].push({
      start,
      stop,
      title: titleEl?.textContent ?? '',
      description: descEl?.textContent ?? '',
      category: catEl?.textContent ?? '',
      icon: iconEl?.getAttribute('src') ?? '',
    });
  }

  if (skippedDate) console.warn(`[EPG] Skipped ${skippedDate} programmes with unparseable dates`);
  if (skippedRange) console.log(`[EPG] Skipped ${skippedRange} programmes outside time range`);
  console.log(`[EPG] Loaded programmes for ${Object.keys(programmes).length} channels`);

  for (const id of Object.keys(programmes)) {
    programmes[id].sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return { channels, programmes };
}
