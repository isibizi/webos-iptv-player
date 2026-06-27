import { describe, it, expect } from 'vitest';
import { parseTimestamp, parseWebVTT } from './webvtt';

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
      { start: 10, end: 12, text: '<c.cyan>Hello</c>' },
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
