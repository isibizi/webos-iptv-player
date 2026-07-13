import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { firstSubtitleFromZip, firstSubtitleBytesFromZip } from './unzip';

describe('firstSubtitleFromZip', () => {
  it('returns the first subtitle entry decoded as text', async () => {
    const zip = zipSync({
      'readme.txt': strToU8('ignore me'),
      'movie.srt': strToU8('1\n00:00:01,000 --> 00:00:02,000\nhello\n'),
    });
    const out = await firstSubtitleFromZip(zip);
    expect(out?.name).toBe('movie.srt');
    expect(out?.text).toContain('hello');
  });

  it('returns null when the zip has no subtitle file', async () => {
    expect(await firstSubtitleFromZip(zipSync({ 'a.txt': strToU8('x') }))).toBeNull();
  });

  it('returns null on invalid zip bytes', async () => {
    expect(await firstSubtitleFromZip(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('firstSubtitleBytesFromZip', () => {
  it('returns the first subtitle entry as raw bytes', async () => {
    const zip = zipSync({ 'note.txt': strToU8('x'), 'movie.srt': strToU8('hi') });
    const out = await firstSubtitleBytesFromZip(zip);
    expect(out?.name).toBe('movie.srt');
    expect(Array.from(out!.bytes)).toEqual(Array.from(strToU8('hi')));
  });

  it('returns null when there is no subtitle entry', async () => {
    expect(await firstSubtitleBytesFromZip(zipSync({ 'a.txt': strToU8('x') }))).toBeNull();
  });
});
