import { describe, it, expect } from 'vitest';
import { parseTimestamp, parseWebVTT, applyCueSettings } from './webvtt';

describe('parseTimestamp', () => {
  it('parses MM:SS.mmm and HH:MM:SS.mmm (any hours magnitude)', () => {
    expect(parseTimestamp('00:02.000')).toBe(2);
    expect(parseTimestamp('01:02:03.500')).toBeCloseTo(3723.5, 3);
    expect(parseTimestamp('159:04:22.306')).toBeCloseTo(572662.306, 3);
  });

  it('returns NaN for junk', () => {
    expect(parseTimestamp('nope')).toBeNaN();
  });

  it('rejects malformed values that would silently mistime', () => {
    expect(parseTimestamp('00:00:01,500')).toBeNaN();   // SRT comma decimal
    expect(parseTimestamp('00:00:01.5e2')).toBeNaN();   // scientific notation
    expect(parseTimestamp('0x10:00.000')).toBeNaN();    // hex
    expect(parseTimestamp('00:99.000')).toBeNaN();      // out-of-range minutes
    expect(parseTimestamp('Infinity')).toBeNaN();
  });
});

describe('parseWebVTT', () => {
  it('reads the X-TIMESTAMP-MAP LOCAL anchor and the cues', () => {
    const vtt = [
      'WEBVTT',
      'X-TIMESTAMP-MAP=LOCAL:00:00:10.000,MPEGTS:900000',
      '',
      '1',
      '00:00:10.000 --> 00:00:12.000 line:90%',
      '<c.cyan>Hello</c>',
      '',
      '00:00:12.500 --> 00:00:14.000',
      'second line',
    ].join('\n');
    const { mapLocal, cues } = parseWebVTT(vtt);
    expect(mapLocal).toBe(10);
    expect(cues).toEqual([
      { start: 10, end: 12, text: '<c.cyan>Hello</c>', settings: { line: 90, snapToLines: false } },
      { start: 12.5, end: 14, text: 'second line' },
    ]);
  });

  it('keeps multi-line cue text and defaults mapLocal to 0', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:03.000\nline one\nline two\n';
    const { mapLocal, cues } = parseWebVTT(vtt);
    expect(mapLocal).toBe(0);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('line one\nline two');
  });

  it('ignores zero/negative-duration and malformed cues', () => {
    const vtt = 'WEBVTT\n\n00:05.000 --> 00:05.000\nempty\n\nbad --> also-bad\nx\n';
    expect(parseWebVTT(vtt).cues).toEqual([]);
  });

  it('returns no cues for a header-only segment', () => {
    expect(parseWebVTT('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:0\n').cues).toEqual([]);
  });

  it('does not turn a NOTE comment containing "-->" into a phantom cue', () => {
    const vtt = [
      'WEBVTT', '',
      'NOTE', 'review 00:00:01.000 --> 00:00:02.000 looks off', '',
      '00:00:09.000 --> 00:00:10.000', 'Track 1',
    ].join('\n');
    expect(parseWebVTT(vtt).cues).toEqual([{ start: 9, end: 10, text: 'Track 1' }]);
  });

  it('skips a STYLE block whose CSS contains "-->"', () => {
    const vtt = [
      'WEBVTT', '',
      'STYLE', '::cue { /* 00:00:01.000 --> 00:00:02.000 */ }', '',
      '00:00:03.000 --> 00:00:04.000', 'Track 1',
    ].join('\n');
    expect(parseWebVTT(vtt).cues).toEqual([{ start: 3, end: 4, text: 'Track 1' }]);
  });
});

describe('parseWebVTT cue settings', () => {
  const cue = (settings: string) =>
    parseWebVTT(`WEBVTT\n\n00:01.000 --> 00:03.000 ${settings}\nhi`).cues[0];

  it('parses every positioning setting into a structured object', () => {
    expect(cue('vertical:rl line:50% position:20% size:80% align:start')).toEqual({
      start: 1, end: 3, text: 'hi',
      settings: { vertical: 'rl', line: 50, snapToLines: false, position: 20, size: 80, align: 'start' },
    });
  });

  it('treats a bare line number as a line index (snapToLines true)', () => {
    expect(cue('line:5').settings).toEqual({ line: 5, snapToLines: true });
  });

  it('accepts a negative line number (count from the bottom)', () => {
    expect(cue('line:-1').settings).toEqual({ line: -1, snapToLines: true });
  });

  it('reads the line/position alignment sub-settings', () => {
    expect(cue('line:30%,end position:10%,line-left').settings).toEqual({
      line: 30, snapToLines: false, lineAlign: 'end',
      position: 10, positionAlign: 'line-left',
    });
  });

  it('omits the settings field entirely when the cue has none', () => {
    expect('settings' in cue('')).toBe(false);
  });

  it('ignores unknown names and malformed values', () => {
    // region (no REGION-block support), unknown key, bad enum, non-numeric size
    expect(cue('region:r1 foo:bar align:weird size:nan%').settings).toBeUndefined();
  });
});

describe('applyCueSettings', () => {
  it('assigns every defined field onto the cue', () => {
    const target: Record<string, unknown> = {};
    applyCueSettings(target, {
      vertical: 'lr', line: 50, snapToLines: false, lineAlign: 'start',
      position: 25, positionAlign: 'center', size: 90, align: 'end',
    });
    expect(target).toEqual({
      vertical: 'lr', line: 50, snapToLines: false, lineAlign: 'start',
      position: 25, positionAlign: 'center', size: 90, align: 'end',
    });
  });

  it('touches only the provided fields', () => {
    const target: Record<string, unknown> = { existing: 1 };
    applyCueSettings(target, { align: 'start' });
    expect(target).toEqual({ existing: 1, align: 'start' });
  });
});
