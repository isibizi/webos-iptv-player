// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { AudioTrackOption, SubtitleTrackOption } from '../types';
import { resolutionBadge, parseVariants, pickVariant, codecName, audioSummary, subtitleSummary } from './stream-info';

const a = (over: Partial<AudioTrackOption>): AudioTrackOption => ({ index: 0, label: '', active: false, ...over });
const s = (over: Partial<SubtitleTrackOption>): SubtitleTrackOption => ({ index: 0, label: '', active: false, ...over });

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  'v0.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160,CODECS="hvc1.1.6.L150,ec-3"',
  'v1.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000',
  'v2.m3u8',
].join('\n');

describe('resolutionBadge', () => {
  it('tiers by height', () => {
    expect(resolutionBadge(2160)).toEqual({ label: '4K', tier: 'uhd' });
    expect(resolutionBadge(1080)).toEqual({ label: '1080p', tier: 'fhd' });
    expect(resolutionBadge(1088)).toEqual({ label: '1080p', tier: 'fhd' });
    expect(resolutionBadge(720)).toEqual({ label: '720p', tier: 'hd' });
    expect(resolutionBadge(576)).toEqual({ label: 'SD', tier: 'sd' });
  });
  it('returns null for unknown height', () => {
    expect(resolutionBadge(0)).toBeNull();
  });
});

describe('parseVariants', () => {
  it('parses resolution and classifies codecs into video/audio', () => {
    const v = parseVariants(MASTER);
    expect(v).toEqual([
      { width: 1920, height: 1080, videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2' },
      { width: 3840, height: 2160, videoCodec: 'hvc1.1.6.L150', audioCodec: 'ec-3' },
      { width: 0, height: 0, videoCodec: '', audioCodec: '' },
    ]);
  });
  it('classifies codecs by prefix regardless of order', () => {
    const m = ['#EXTM3U', '#EXT-X-STREAM-INF:RESOLUTION=1280x720,CODECS="mp4a.40.2,avc1.42c00d"', 'v.m3u8'].join('\n');
    expect(parseVariants(m)).toEqual([{ width: 1280, height: 720, videoCodec: 'avc1.42c00d', audioCodec: 'mp4a.40.2' }]);
  });
});

describe('pickVariant', () => {
  it('matches by exact resolution', () => {
    const v = parseVariants(MASTER);
    expect(pickVariant(v, 3840, 2160)?.videoCodec).toBe('hvc1.1.6.L150');
  });
  it('returns null when nothing matches or size unknown', () => {
    const v = parseVariants(MASTER);
    expect(pickVariant(v, 1280, 720)).toBeNull();
    expect(pickVariant(v, 0, 0)).toBeNull();
  });
});

describe('codecName', () => {
  it('maps known codecs and strips the profile', () => {
    expect(codecName('avc1.640028')).toBe('H.264');
    expect(codecName('hvc1.1.6.L150')).toBe('HEVC');
    expect(codecName('mp4a.40.2')).toBe('AAC');
    expect(codecName('ac-3')).toBe('Dolby Digital');
    expect(codecName('ec-3')).toBe('Dolby Digital+');
    expect(codecName('av01.0.05M')).toBe('AV1');
    expect(codecName('vp9')).toBe('VP9');
  });
  it('returns "" for empty or unknown', () => {
    expect(codecName('')).toBe('');
    expect(codecName('weird1')).toBe('');
  });
});

describe('audioSummary', () => {
  it('shows the active label, with a count when more than one', () => {
    expect(audioSummary([])).toBe('');
    expect(audioSummary([a({ label: 'Track 1', active: true })])).toBe('Track 1');
    expect(audioSummary([a({ label: 'Track 1' }), a({ index: 1, label: 'Track 2', active: true })])).toBe('Track 2 (2)');
  });
  it('falls back to the first track when none is flagged active', () => {
    expect(audioSummary([a({ label: 'Track 1' })])).toBe('Track 1');
    expect(audioSummary([a({ label: 'Track 1' }), a({ index: 1, label: 'Track 2' })])).toBe('Track 1 (2)');
  });
});

describe('subtitleSummary', () => {
  it('shows active label, Off when none active, "" when no tracks', () => {
    expect(subtitleSummary([])).toBe('');
    expect(subtitleSummary([s({ label: 'Track 1' })])).toBe('Off');
    expect(subtitleSummary([s({ label: 'Track 1', active: true })])).toBe('Track 1');
    expect(subtitleSummary([s({ label: 'Track 1', active: true }), s({ index: 1, label: 'Track 2' })])).toBe('Track 1 (2)');
  });
});
