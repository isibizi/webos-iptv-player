import { describe, it, expect } from 'vitest';
import { stabilizeManifest } from './hls-stable-loader';

// Build a media playlist with the given media-sequence and segment URIs.
const media = (seq: number, segs: string[]) =>
  ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-MEDIA-SEQUENCE:${seq}`, '#EXT-X-TARGETDURATION:8',
    ...segs.flatMap((s) => ['#EXTINF:5,', s])].join('\n');

const uris = (m: string) => m.split('\n').filter((l) => l && !l.startsWith('#'));
const comparedPath = (uri: string) => uri.split('?')[0];

describe('stabilizeManifest', () => {
  it('rewrites each segment to a sequence-keyed URI with the real URL in the query', () => {
    const out = uris(stabilizeManifest(media(100, ['http://host/a/1.ts', 'http://host/a/2.ts'])));
    expect(out[0]).toBe(`http://hls-stable.invalid/100.ts?__real=${encodeURIComponent('http://host/a/1.ts')}`);
    expect(out[1]).toBe(`http://hls-stable.invalid/101.ts?__real=${encodeURIComponent('http://host/a/2.ts')}`);
  });

  it('keeps the compared path stable for a sequence number even when the real URL rotates', () => {
    // Two reloads: window slides 100-101 → 101-102, and the real host/path for the
    // overlapping segment (sn 101) changes — exactly what tripped hls.js.
    const a = uris(stabilizeManifest(media(100, ['http://host-a/x/1.ts', 'http://host-a/x/2.ts'])));
    const b = uris(stabilizeManifest(media(101, ['http://host-b/y/2.ts', 'http://host-b/y/3.ts'])));
    expect(comparedPath(a[1])).toBe(comparedPath(b[0])); // sn 101 → identical compared path
    expect(a[1]).not.toBe(b[0]); // ...while the real URL (in the query) still differs
  });

  it('resolves relative segment URIs against the playlist base URL', () => {
    const m = ['#EXTM3U', '#EXT-X-MEDIA-SEQUENCE:0', '#EXTINF:5,', 'sub/dir/1.ts'].join('\n');
    const seg = uris(stabilizeManifest(m, 'http://host/live/index.m3u8'))[0];
    expect(decodeURIComponent(seg.split('__real=')[1])).toBe('http://host/live/sub/dir/1.ts');
  });

  it('round-trips the real URL through the query param', () => {
    const real = 'http://host/a/seg.ts?token=abc&x=1';
    const seg = uris(stabilizeManifest(media(5, [real])))[0];
    expect(decodeURIComponent(seg.split('__real=')[1])).toBe(real);
  });

  it('passes a master playlist through unchanged', () => {
    const master = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1', 'http://host/v/index.m3u8'].join('\n');
    expect(stabilizeManifest(master)).toBe(master);
  });

  it('leaves non-HLS content untouched', () => {
    expect(stabilizeManifest('not a playlist')).toBe('not a playlist');
  });
});
