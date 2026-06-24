import { describe, it, expect } from 'vitest';
import { parseM3U } from './m3u-parser';

describe('parseM3U', () => {
  it('parses a basic channel with URL', () => {
    const m3u = ['#EXTM3U', '#EXTINF:-1,Channel One', 'http://example.com/1.m3u8'].join('\n');
    const result = parseM3U(m3u);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].name).toBe('Channel One');
    expect(result.channels[0].url).toBe('http://example.com/1.m3u8');
  });

  it('extracts tvg attributes and group-title', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="c1" tvg-name="News HD" tvg-logo="http://logo/1.png" group-title="News",News',
      'http://example.com/news.m3u8',
    ].join('\n');
    const ch = parseM3U(m3u).channels[0];
    expect(ch.id).toBe('c1');
    expect(ch.name).toBe('News HD'); // tvg-name takes precedence over the display title
    expect(ch.logo).toBe('http://logo/1.png');
    expect(ch.group).toBe('News');
  });

  it('falls back to the display title and Uncategorized group', () => {
    const m3u = ['#EXTM3U', '#EXTINF:-1,Bare Channel', 'http://example.com/bare.m3u8'].join('\n');
    const ch = parseM3U(m3u).channels[0];
    expect(ch.name).toBe('Bare Channel');
    expect(ch.group).toBe('Uncategorized');
  });

  it('collects the distinct set of groups', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="A",One',
      'http://e/1',
      '#EXTINF:-1 group-title="B",Two',
      'http://e/2',
      '#EXTINF:-1 group-title="A",Three',
      'http://e/3',
    ].join('\n');
    expect(parseM3U(m3u).groups).toEqual(['A', 'B']);
  });

  it('reads the embedded EPG url from #EXTM3U (url-tvg / x-tvg-url)', () => {
    expect(parseM3U('#EXTM3U url-tvg="http://epg/guide.xml"').epgUrl).toBe('http://epg/guide.xml');
    expect(parseM3U('#EXTM3U x-tvg-url="http://epg/alt.xml"').epgUrl).toBe('http://epg/alt.xml');
  });

  it('lets #EXTGRP override the group-title', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="Old",Ch',
      '#EXTGRP:Movies',
      'http://e/1',
    ].join('\n');
    expect(parseM3U(m3u).channels[0].group).toBe('Movies');
  });

  it('captures #EXTVLCOPT and #KODIPROP as extras', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1,Ch',
      '#EXTVLCOPT:http-user-agent=Mozilla',
      '#KODIPROP:inputstream.adaptive.license_type=clearkey',
      'http://e/1',
    ].join('\n');
    const ch = parseM3U(m3u).channels[0];
    expect(ch.extras).toMatchObject({
      'http-user-agent': 'Mozilla',
      'inputstream.adaptive.license_type': 'clearkey',
    });
  });

  it('ignores blank lines and CRLF line endings', () => {
    const m3u = '#EXTM3U\r\n\r\n#EXTINF:-1,Ch\r\nhttp://e/1\r\n';
    expect(parseM3U(m3u).channels).toHaveLength(1);
  });

  it('returns an empty result for input with no entries', () => {
    const result = parseM3U('#EXTM3U');
    expect(result.channels).toEqual([]);
    expect(result.groups).toEqual([]);
  });

  it('wraps a bare HLS stream (HLS tags, no #EXTINF) as a single channel from the source URL', () => {
    const hls = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', 'https://cdn/inner.m3u8'].join('\n');
    const result = parseM3U(hls, 'https://example.com/hls/news.m3u8');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].url).toBe('https://example.com/hls/news.m3u8'); // the stream URL itself, not the inner variant
    expect(result.channels[0].name).toBe('news');
    expect(result.groups).toEqual(['Uncategorized']);
  });

  it('wraps a bare HLS *media* playlist (segments, not channels) as one channel — no "no desc" rows', () => {
    const media = [
      '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-MEDIA-SEQUENCE:100', '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10.000, no desc', 'seg-100.ts',
      '#EXTINF:10.000, no desc', 'seg-101.ts',
      '#EXTINF:10.000, no desc', 'seg-102.ts',
    ].join('\n');
    const result = parseM3U(media, 'https://example.com/live/stream_hd.m3u8');
    expect(result.channels).toHaveLength(1); // the whole stream, not one channel per segment
    expect(result.channels[0].name).toBe('stream_hd');
    expect(result.channels[0].url).toBe('https://example.com/live/stream_hd.m3u8');
  });

  it('does not wrap an HLS stream when no source URL is supplied', () => {
    const hls = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1', 'https://cdn/inner.m3u8'].join('\n');
    expect(parseM3U(hls).channels).toEqual([]);
  });

  it('does not wrap a normal channel list (no HLS tags) even with a source URL', () => {
    const m3u = ['#EXTM3U', '#EXTINF:-1,Ch', 'http://e/1'].join('\n');
    const result = parseM3U(m3u, 'http://host/list.m3u');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].name).toBe('Ch');
  });
});
