// Minimal WebVTT parser for HLS subtitle segments. Extracts the X-TIMESTAMP-MAP
// LOCAL anchor and each cue's start/end/text (markup like <c.cyan> is kept — Blink
// parses it when the cue is rendered). Tolerant of messy real-world segments.

export interface VttCue {
  start: number; // seconds, in the WebVTT LOCAL timeline
  end: number;
  text: string;
  settings?: VttCueSettings; // cue positioning — present only when the cue declares any
}

/** The WebVTT cue-setting attributes we carry to the `VTTCue` (the subset Blink's
 *  `VTTCueBox` renders). `region` is intentionally absent: we skip REGION blocks,
 *  so there's no `VTTRegion` to bind a cue to. */
export interface VttCueSettings {
  vertical?: 'rl' | 'lr';
  line?: number;
  snapToLines?: boolean; // false when `line` was a percentage, true for a line index
  lineAlign?: 'start' | 'center' | 'end';
  position?: number;
  positionAlign?: 'line-left' | 'center' | 'line-right';
  size?: number;
  align?: 'start' | 'center' | 'end' | 'left' | 'right';
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
    // After '-->': the end timestamp, then optional `name:value` cue settings.
    const after = block[t].slice(arrow + 3).trim().split(/\s+/);
    const ce = parseTimestamp(after[0] || '');
    if (Number.isFinite(cs) && Number.isFinite(ce) && ce > cs) {
      const cue: VttCue = { start: cs, end: ce, text: block.slice(t + 1).join('\n').trim() };
      const settings = parseCueSettings(after.slice(1));
      if (settings) cue.settings = settings;
      cues.push(cue);
    }
  }
  return { mapLocal, cues };
}

// A finite number from a `N` / `N%` cue-setting value; null on empty/garbage
// (Number('') is 0, so the empty guard matters).
function num(s: string): number | null {
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse the WebVTT cue-setting tokens (the `name:value` list after the end
 *  timestamp) into the VTTCue positioning props Blink honors. Unknown names and
 *  malformed values are dropped; returns undefined when nothing usable parsed. */
function parseCueSettings(tokens: string[]): VttCueSettings | undefined {
  const s: VttCueSettings = {};
  let any = false;
  for (const tok of tokens) {
    const i = tok.indexOf(':');
    if (i < 1) continue;
    const name = tok.slice(0, i);
    const value = tok.slice(i + 1);
    if (name === 'vertical') {
      if (value === 'rl' || value === 'lr') { s.vertical = value; any = true; }
    } else if (name === 'line') {
      const [pos, align] = value.split(',');
      const pct = pos.endsWith('%');
      const n = num(pct ? pos.slice(0, -1) : pos);
      if (n !== null) { s.line = n; s.snapToLines = !pct; any = true; }
      if (align === 'start' || align === 'center' || align === 'end') { s.lineAlign = align; any = true; }
    } else if (name === 'position') {
      const [pos, align] = value.split(',');
      const n = pos.endsWith('%') ? num(pos.slice(0, -1)) : null;
      if (n !== null) { s.position = n; any = true; }
      if (align === 'line-left' || align === 'center' || align === 'line-right') { s.positionAlign = align; any = true; }
    } else if (name === 'size') {
      const n = value.endsWith('%') ? num(value.slice(0, -1)) : null;
      if (n !== null) { s.size = n; any = true; }
    } else if (name === 'align') {
      if (value === 'start' || value === 'center' || value === 'end' || value === 'left' || value === 'right') {
        s.align = value; any = true;
      }
    }
  }
  return any ? s : undefined;
}

/** Apply parsed cue settings onto a `VTTCue` (or any object with those props) —
 *  each field maps to the same-named positioning property Blink renders. */
export function applyCueSettings(cue: Partial<Record<keyof VttCueSettings, unknown>>, s: VttCueSettings): void {
  if (s.vertical !== undefined) cue.vertical = s.vertical;
  if (s.line !== undefined) cue.line = s.line;
  if (s.snapToLines !== undefined) cue.snapToLines = s.snapToLines;
  if (s.lineAlign !== undefined) cue.lineAlign = s.lineAlign;
  if (s.position !== undefined) cue.position = s.position;
  if (s.positionAlign !== undefined) cue.positionAlign = s.positionAlign;
  if (s.size !== undefined) cue.size = s.size;
  if (s.align !== undefined) cue.align = s.align;
}
