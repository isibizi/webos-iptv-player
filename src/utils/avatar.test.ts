import { describe, it, expect } from 'vitest';
import { avatarColor, firstLetter } from './avatar';

describe('firstLetter', () => {
  it('uppercases the first Latin letter', () => {
    expect(firstLetter('alpha')).toBe('A');
    expect(firstLetter('Bravo')).toBe('B');
  });
  it('falls back to # for empty or whitespace-only labels', () => {
    expect(firstLetter('')).toBe('#');
    expect(firstLetter('   ')).toBe('#');
  });
  it('falls back to # for a digit or punctuation first char', () => {
    expect(firstLetter('123')).toBe('#');
    expect(firstLetter('#tag')).toBe('#');
  });
  it('uppercases a cased non-Latin letter', () => {
    expect(firstLetter('\u03bb-feed')).toBe('\u039b'); // Greek small lambda -> capital lambda
  });
});

describe('avatarColor', () => {
  it('is deterministic for the same name', () => {
    expect(avatarColor('Alpha')).toBe(avatarColor('Alpha'));
  });
  it('produces a valid fixed-S/L hsl string', () => {
    expect(avatarColor('Alpha')).toMatch(/^hsl\(\d{1,3}, 55%, 45%\)$/);
  });
  it('separates distinct names by hue', () => {
    expect(avatarColor('Alpha')).not.toBe(avatarColor('Bravo'));
  });
});
