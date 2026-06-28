import type { AudioTrackOption, SubtitleTrackOption } from '../types';

export type StreamVariant = { width: number; height: number; videoCodec: string; audioCodec: string };
export type ResolutionBadge = { label: string; tier: 'uhd' | 'fhd' | 'hd' | 'sd' };

// Height-based resolution tier. 0/falsy → null (resolution not known yet).
export function resolutionBadge(height: number): ResolutionBadge | null {
  if (!height) return null;
  if (height >= 2160) return { label: '4K', tier: 'uhd' };
  if (height >= 1080) return { label: '1080p', tier: 'fhd' };
  if (height >= 720) return { label: '720p', tier: 'hd' };
  return { label: 'SD', tier: 'sd' };
}

const VIDEO_PREFIXES = ['avc1', 'avc3', 'hvc1', 'hev1', 'dvh1', 'dvhe', 'vp09', 'vp9', 'vp08', 'vp8', 'av01', 'mp4v'];
const AUDIO_PREFIXES = ['mp4a', 'ac-3', 'ec-3', 'ac-4', 'opus', 'mp3', 'flac', 'dtsc', 'dtse'];

function classify(token: string): 'video' | 'audio' | null {
  const t = token.trim().toLowerCase();
  if (VIDEO_PREFIXES.some(p => t.startsWith(p))) return 'video';
  if (AUDIO_PREFIXES.some(p => t.startsWith(p))) return 'audio';
  return null;
}

// Parse master EXT-X-STREAM-INF lines into one variant each: RESOLUTION=WxH
// (0/0 when absent) and the first video + first audio CODECS token (raw).
export function parseVariants(manifest: string): StreamVariant[] {
  const variants: StreamVariant[] = [];
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const res = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const cod = line.match(/CODECS="([^"]*)"/i);
    let videoCodec = '';
    let audioCodec = '';
    if (cod) {
      for (const tok of cod[1].split(',')) {
        const kind = classify(tok);
        if (kind === 'video' && !videoCodec) videoCodec = tok.trim();
        else if (kind === 'audio' && !audioCodec) audioCodec = tok.trim();
      }
    }
    variants.push({
      width: res ? parseInt(res[1], 10) : 0,
      height: res ? parseInt(res[2], 10) : 0,
      videoCodec,
      audioCodec,
    });
  }
  return variants;
}

// Exact resolution match against the real videoWidth/Height. Unknown size → null.
export function pickVariant(variants: StreamVariant[], width: number, height: number): StreamVariant | null {
  if (!width || !height) return null;
  return variants.find(v => v.width === width && v.height === height) || null;
}

const CODEC_MAP: Record<string, string> = {
  avc1: 'H.264', avc3: 'H.264',
  hvc1: 'HEVC', hev1: 'HEVC', hevc: 'HEVC',
  dvh1: 'Dolby Vision', dvhe: 'Dolby Vision',
  vp09: 'VP9', vp9: 'VP9', vp08: 'VP8', vp8: 'VP8',
  av01: 'AV1',
  mp4a: 'AAC',
  'ac-3': 'Dolby Digital', 'ec-3': 'Dolby Digital+', 'ac-4': 'Dolby AC-4',
  opus: 'Opus', mp3: 'MP3', flac: 'FLAC',
  dtsc: 'DTS', dtse: 'DTS',
};

// Friendly name from a CODECS token; '' for empty/unknown (caller omits it).
export function codecName(codec: string): string {
  return CODEC_MAP[codec.trim().toLowerCase().split('.')[0]] ?? '';
}

export function audioSummary(tracks: AudioTrackOption[]): string {
  if (!tracks.length) return '';
  // Audio has no "off" state — if no track is flagged active yet (the flag can
  // lag at tune-in), fall back to the first/default track, which is what plays.
  const active = tracks.find(t => t.active) ?? tracks[0];
  const label = active.label || 'Audio';
  return tracks.length > 1 ? `${label} (${tracks.length})` : label;
}

export function subtitleSummary(tracks: SubtitleTrackOption[]): string {
  if (!tracks.length) return '';
  const active = tracks.find(t => t.active);
  const base = active ? (active.label || 'On') : 'Off';
  return tracks.length > 1 ? `${base} (${tracks.length})` : base;
}
