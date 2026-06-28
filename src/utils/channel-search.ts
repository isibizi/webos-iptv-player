import type { Channel } from '../types';

// Rank channels whose name contains the query, best match first. Name-only; the
// match predicate (lowercased name includes the trimmed lowercased query) is
// unchanged, so the result SET equals a plain substring filter — only the order
// changes.
export function rankChannels(channels: Channel[], query: string): Channel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { ch: Channel; tier: number; pos: number; len: number; idx: number }[] = [];
  for (let i = 0; i < channels.length; i++) {
    const name = channels[i].name.toLowerCase();
    const pos = name.indexOf(q);
    if (pos === -1) continue;
    let tier: number;
    if (name === q) tier = 0;                            // exact
    else if (pos === 0) tier = 1;                        // prefix
    else if (!/[a-z0-9]/.test(name[pos - 1])) tier = 2;  // query starts a word
    else tier = 3;                                       // mid-word substring
    scored.push({ ch: channels[i], tier, pos, len: name.length, idx: i });
  }
  scored.sort((a, b) =>
    a.tier - b.tier ||   // better tier first
    a.pos - b.pos ||     // earlier match first
    a.len - b.len ||     // shorter (more specific) name first
    a.idx - b.idx);      // original order — explicit, Chrome 68 sort isn't stable
  return scored.map(s => s.ch);
}
