import { describe, it, expect } from 'vitest';
import { truncate } from './text';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('Alpha', 40)).toBe('Alpha');
    expect(truncate('', 5)).toBe('');
  });

  it('leaves a string exactly at the cap untouched (no ellipsis)', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });

  it('truncates and appends an ellipsis when over the cap', () => {
    expect(truncate('123456', 5)).toBe('12345…');
  });

  it('counts by code point so astral characters are kept whole, not split', () => {
    // '😀' is a surrogate pair (.length 2); code-point truncation never cuts it
    // in half. Same mechanism applies to CJK Extension-B ideographs.
    expect(truncate('a😀b', 2)).toBe('a😀…');
    expect(truncate('😀😀', 2)).toBe('😀😀');
  });
});
