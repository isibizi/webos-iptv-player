import type { Channel } from '../types';

// FNV-1a (32-bit) — fast, dependency-free, non-cryptographic. Good enough for a
// stable short identity key; collisions are negligible at playlist scale.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable per-stream identity for a channel, used to key user data and list
 * reconciliation. Hashes the URL with its query and fragment stripped: tokens
 * live in the query (so the key survives rotation), distinct streams keep
 * distinct paths, and hashing avoids persisting any credentials in the URL.
 */
export function channelKey(ch: Channel): string {
  const stable = (ch.url || '').split('#')[0].split('?')[0];
  return fnv1a(stable);
}
