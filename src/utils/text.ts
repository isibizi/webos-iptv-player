/**
 * Cap a string to `max` characters, appending an ellipsis when it overflows.
 * Counts by Unicode code point (via the string iterator) so a multi-code-unit
 * character — emoji, a CJK Extension-B ideograph — counts as one and is never
 * split across its surrogate pair. (Common CJK is in the BMP: one unit each.)
 */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : s;
}
