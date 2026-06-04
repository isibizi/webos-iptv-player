import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseXmltvDate,
  formatTime,
  formatDuration,
  getTimeSlots,
  isNow,
  getProgress,
} from './time';

describe('parseXmltvDate', () => {
  it('parses a timestamp with an explicit timezone offset', () => {
    const d = parseXmltvDate('20240601120000 +0200');
    expect(d?.getTime()).toBe(Date.UTC(2024, 5, 1, 10, 0, 0));
  });

  it('treats a timestamp without a timezone as UTC', () => {
    const d = parseXmltvDate('20240601120000');
    expect(d?.getTime()).toBe(Date.UTC(2024, 5, 1, 12, 0, 0));
  });

  it('handles a negative timezone offset', () => {
    const d = parseXmltvDate('20240601120000 -0500');
    expect(d?.getTime()).toBe(Date.UTC(2024, 5, 1, 17, 0, 0));
  });

  it('returns null for empty or malformed input', () => {
    expect(parseXmltvDate(null)).toBeNull();
    expect(parseXmltvDate('')).toBeNull();
    expect(parseXmltvDate('2024-06-01')).toBeNull();
    expect(parseXmltvDate('not a date')).toBeNull();
  });
});

describe('formatTime', () => {
  it('zero-pads hours and minutes (local time)', () => {
    expect(formatTime(new Date(2024, 0, 1, 9, 5))).toBe('09:05');
    expect(formatTime(new Date(2024, 0, 1, 23, 59))).toBe('23:59');
  });

  // Regression for the webOS "24:30" bug: midnight must render as 00:xx, never 24:xx.
  // (toLocaleTimeString with the h24 hour cycle used to emit "24:00" at midnight.)
  it('renders midnight as 00:xx, never 24:xx', () => {
    expect(formatTime(new Date(2024, 0, 2, 0, 0))).toBe('00:00');
    expect(formatTime(new Date(2024, 0, 2, 0, 30))).toBe('00:30');
  });
});

describe('formatDuration', () => {
  it('formats sub-hour durations as minutes only', () => {
    expect(formatDuration(5 * 60000)).toBe('5m');
    expect(formatDuration(0)).toBe('0m');
  });

  it('formats hour-plus durations with hours and minutes', () => {
    expect(formatDuration(65 * 60000)).toBe('1h 5m');
    expect(formatDuration(120 * 60000)).toBe('2h 0m');
  });
});

describe('getTimeSlots', () => {
  it('rounds the start down to the slot boundary and returns one slot per interval', () => {
    const slots = getTimeSlots(new Date(2024, 0, 1, 10, 20), 2, 30);
    expect(slots).toHaveLength(4); // 2h / 30m
    expect(formatTime(slots[0])).toBe('10:00');
    expect(formatTime(slots[1])).toBe('10:30');
    expect(formatTime(slots[3])).toBe('11:30');
  });

  it('renders post-midnight slots as 00:xx, never 24:xx', () => {
    const slots = getTimeSlots(new Date(2024, 0, 1, 23, 20), 2, 30);
    expect(slots.map(formatTime)).toEqual(['23:00', '23:30', '00:00', '00:30']);
  });
});

describe('isNow / getProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('isNow is true only when now is within [start, stop)', () => {
    const now = Date.now();
    expect(isNow(new Date(now - 1000), new Date(now + 1000))).toBe(true);
    expect(isNow(new Date(now + 1000), new Date(now + 2000))).toBe(false);
    expect(isNow(new Date(now - 2000), new Date(now))).toBe(false); // stop == now is exclusive
  });

  it('getProgress returns a clamped 0..1 fraction', () => {
    const now = Date.now();
    expect(getProgress(new Date(now - 50), new Date(now + 50))).toBeCloseTo(0.5, 5);
    expect(getProgress(new Date(now + 100), new Date(now + 200))).toBe(0); // not started
    expect(getProgress(new Date(now - 200), new Date(now - 100))).toBe(1); // finished
  });

  it('getProgress returns 0 for a non-positive duration', () => {
    const now = Date.now();
    expect(getProgress(new Date(now), new Date(now))).toBe(0);
  });
});
