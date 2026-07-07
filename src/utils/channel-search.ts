// Rank items whose name contains the query, best match first. Name-only, so it
// works for any named item (channels, movies, series); the match predicate
// (lowercased name includes the trimmed lowercased query) equals a plain
// substring filter — only the order changes.
export function rankByName<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { item: T; tier: number; pos: number; len: number; idx: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const name = items[i].name.toLowerCase();
    const pos = name.indexOf(q);
    if (pos === -1) continue;
    let tier: number;
    if (name === q) tier = 0;                            // exact
    else if (pos === 0) tier = 1;                        // prefix
    else if (!/[a-z0-9]/.test(name[pos - 1])) tier = 2;  // query starts a word
    else tier = 3;                                       // mid-word substring
    scored.push({ item: items[i], tier, pos, len: name.length, idx: i });
  }
  scored.sort((a, b) =>
    a.tier - b.tier ||   // better tier first
    a.pos - b.pos ||     // earlier match first
    a.len - b.len ||     // shorter (more specific) name first
    a.idx - b.idx);      // original order — explicit, Chrome 68 sort isn't stable
  return scored.map(s => s.item);
}
