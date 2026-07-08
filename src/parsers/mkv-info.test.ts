import { describe, it, expect } from 'vitest';
import { parseMkvInfo } from './mkv-info';

// --- Synthetic EBML builders (test fixtures only) ---
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function encodeSize(n: number): number[] {
  let len = 1;
  while (n >= Math.pow(2, 7 * len) - 1) len++;
  const bytes = new Array(len).fill(0);
  let v = n;
  for (let i = len - 1; i >= 0; i--) {
    bytes[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  bytes[0] |= 0x80 >> (len - 1);
  return bytes;
}

function uint(n: number, len: number): number[] {
  const bytes = new Array(len).fill(0);
  let v = n;
  for (let i = len - 1; i >= 0; i--) {
    bytes[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return bytes;
}

const elem = (id: number[], data: number[]): number[] => [...id, ...encodeSize(data.length), ...data];

const ID = {
  Segment: [0x18, 0x53, 0x80, 0x67],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackType: [0x83],
  CodecID: [0x86],
  DefaultDuration: [0x23, 0xe3, 0x83],
  Video: [0xe0],
  PixelWidth: [0xb0],
  PixelHeight: [0xba],
  Colour: [0x55, 0xb0],
  TransferCharacteristics: [0x55, 0xba],
};

function videoTrack(opts: { codecId: string; w: number; h: number; defaultDuration?: number; transfer?: number }): number[] {
  const colour = opts.transfer !== undefined ? elem(ID.Colour, elem(ID.TransferCharacteristics, uint(opts.transfer, 1))) : [];
  const video = elem(ID.Video, [...elem(ID.PixelWidth, uint(opts.w, 2)), ...elem(ID.PixelHeight, uint(opts.h, 2)), ...colour]);
  const dd = opts.defaultDuration !== undefined ? elem(ID.DefaultDuration, uint(opts.defaultDuration, 4)) : [];
  return elem(ID.TrackEntry, [...elem(ID.TrackType, uint(1, 1)), ...elem(ID.CodecID, ascii(opts.codecId)), ...dd, ...video]);
}

function audioTrack(codecId: string): number[] {
  return elem(ID.TrackEntry, [...elem(ID.TrackType, uint(2, 1)), ...elem(ID.CodecID, ascii(codecId))]);
}

function mkvFile(tracks: number[][]): Uint8Array {
  return new Uint8Array(elem(ID.Segment, elem(ID.Tracks, tracks.flat())));
}

describe('parseMkvInfo', () => {
  it('parses HEVC video + AAC audio with dimensions and fps', () => {
    const bytes = mkvFile([
      videoTrack({ codecId: 'V_MPEGH/ISO/HEVC', w: 3840, h: 2160, defaultDuration: 41666667 }),
      audioTrack('A_AAC'),
    ]);
    const info = parseMkvInfo(bytes);
    expect(info).not.toBeNull();
    expect(info!.videoCodec).toBe('hvc1');
    expect(info!.audioCodec).toBe('mp4a');
    expect(info!.width).toBe(3840);
    expect(info!.height).toBe(2160);
    expect(info!.fps).toBeCloseTo(24, 1); // 1e9 / 41666667 ns
  });

  it('maps codec IDs by prefix (A_AAC/MPEG4/LC → mp4a, V_AV1 → av01)', () => {
    const bytes = mkvFile([
      videoTrack({ codecId: 'V_AV1', w: 1920, h: 1080 }),
      audioTrack('A_AAC/MPEG4/LC'),
    ]);
    const info = parseMkvInfo(bytes);
    expect(info!.videoCodec).toBe('av01');
    expect(info!.audioCodec).toBe('mp4a');
  });

  it('reads HDR transfer characteristics from Colour (16 → PQ)', () => {
    const bytes = mkvFile([videoTrack({ codecId: 'V_MPEGH/ISO/HEVC', w: 3840, h: 2160, transfer: 16 })]);
    expect(parseMkvInfo(bytes)!.hdr).toBe('PQ');
  });

  it('leaves fps unknown (0) when DefaultDuration is absent', () => {
    const bytes = mkvFile([videoTrack({ codecId: 'V_VP9', w: 1280, h: 720 })]);
    const info = parseMkvInfo(bytes);
    expect(info!.videoCodec).toBe('vp09');
    expect(info!.fps).toBe(0);
  });

  it('returns null for malformed input and when no video track exists', () => {
    expect(parseMkvInfo(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(parseMkvInfo(new Uint8Array(0))).toBeNull();
    expect(parseMkvInfo(mkvFile([audioTrack('A_AAC')]))).toBeNull();
  });
});
