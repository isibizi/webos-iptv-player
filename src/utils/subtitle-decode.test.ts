import { describe, it, expect } from 'vitest';
import { decodeSubtitleBytes } from './subtitle-decode';

describe('decodeSubtitleBytes', () => {
  it('decodes UTF-8 and strips a BOM', () => {
    const utf8 = new TextEncoder().encode('\uFEFFhello 世界');
    expect(decodeSubtitleBytes(utf8)).toBe('hello 世界');
  });

  it('falls back to GB18030 for non-UTF-8 bytes', () => {
    // GB18030 bytes for 你好 (0xC4 0xE3 0xBA 0xC3) — not valid UTF-8
    const gbk = new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3]);
    expect(decodeSubtitleBytes(gbk)).toBe('你好');
  });
});
