import { parseWebVTT, type VttCue } from './webvtt';

// Convert SubRip (SRT) text to WebVTT so `parseWebVTT` can consume it. SRT differs
// only in the ",mmm" fraction separator and the missing WEBVTT header; its numeric
// sequence lines are valid WebVTT cue identifiers, so they pass through untouched.
// Commas are converted only on timing lines, leaving commas in the cue text intact.
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => (line.includes('-->') ? line.replace(/,/g, '.') : line))
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

// Parse a sidecar subtitle file (WebVTT or SRT) to cues. WebVTT is fed straight to
// the parser; anything else is treated as SRT and converted first.
export function parseSubtitleFile(text: string): VttCue[] {
  const vtt = /^\uFEFF?WEBVTT/.test(text) ? text : srtToVtt(text);
  return parseWebVTT(vtt).cues;
}
