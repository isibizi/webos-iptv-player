// Minimal WebVTT parser for HLS subtitle segments. Extracts the X-TIMESTAMP-MAP
// LOCAL anchor and each cue's start/end/text (markup like <c.cyan> is kept — Blink
// parses it when the cue is rendered). Tolerant of messy real-world segments.

export interface VttCue {
  start: number; // seconds, in the WebVTT LOCAL timeline
  end: number;
  text: string;
}

export interface ParsedVtt {
  /** Seconds of the X-TIMESTAMP-MAP LOCAL anchor (0 when absent). */
  mapLocal: number;
  cues: VttCue[];
}

/** Parse "HH:MM:SS.mmm" / "MM:SS.mmm" (WebVTT §4.1 grammar) to seconds. Returns NaN
 *  on any malformed value — comma decimals, signs, scientific/hex notation, or
 *  out-of-range minutes/seconds — so a bad line is dropped, not silently mistimed. */
export function parseTimestamp(ts: string): number {
  const m = /^(?:(\d{1,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(ts.trim());
  if (!m) return NaN;
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

export function parseWebVTT(text: string): ParsedVtt {
  const lines = text.split(/\r?\n/);
  let mapLocal = 0;
  const cues: VttCue[] = [];

  // Parse block-by-block (blocks are separated by blank lines), per WebVTT §6. A
  // bare `-->` scan would misread the timing-like text inside NOTE comments or
  // STYLE/REGION blocks as a cue (injecting phantom captions), so classify each
  // block by its first line before looking for a cue.
  for (let i = 0; i < lines.length; ) {
    if (lines[i].trim() === '') { i++; continue; }
    const start = i;
    while (i < lines.length && lines[i].trim() !== '') i++;
    const block = lines.slice(start, i);
    const head = block[0].trim();

    // X-TIMESTAMP-MAP rides in the header block (alongside the WEBVTT signature).
    for (const bl of block) {
      const tm = /^X-TIMESTAMP-MAP.*?LOCAL:([0-9:.]+)/.exec(bl);
      if (tm) { const v = parseTimestamp(tm[1]); if (Number.isFinite(v)) mapLocal = v; }
    }
    // Non-cue blocks: the WEBVTT header and NOTE/STYLE/REGION. Skip them entirely.
    if (head === 'WEBVTT' || /^WEBVTT[ \t]/.test(head)
      || head === 'NOTE' || /^NOTE[ \t]/.test(head)
      || head === 'STYLE' || head === 'REGION') continue;

    // A cue is an optional identifier line then a "start --> end [settings]" line.
    let t = 0;
    if (block[t].indexOf('-->') === -1) t++; // skip the cue identifier line
    if (t >= block.length) continue;
    const arrow = block[t].indexOf('-->');
    if (arrow === -1) continue;
    const cs = parseTimestamp(block[t].slice(0, arrow).trim().split(/\s+/).pop() || '');
    // The end timestamp is the first token after '-->'; cue settings follow it.
    const ce = parseTimestamp(block[t].slice(arrow + 3).trim().split(/\s+/)[0] || '');
    if (Number.isFinite(cs) && Number.isFinite(ce) && ce > cs) {
      cues.push({ start: cs, end: ce, text: block.slice(t + 1).join('\n').trim() });
    }
  }
  return { mapLocal, cues };
}
