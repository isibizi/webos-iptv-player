import { describe, it, expect } from 'vitest';
import { parseMp4Info } from './mp4-info';

// --- Synthetic ISO-BMFF box builders (test fixtures only) ---
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const zeros = (n: number): number[] => new Array(n).fill(0);

function box(type: string, payload: number[]): number[] {
  return [...u32(8 + payload.length), ...ascii(type), ...payload];
}

const mdhd = (timescale: number, duration: number): number[] =>
  box('mdhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(duration), ...u16(0), ...u16(0)]);

const hdlr = (handler: string): number[] =>
  box('hdlr', [0, 0, 0, 0, ...u32(0), ...ascii(handler), ...zeros(12), 0]);

const colr = (transfer: number): number[] =>
  box('colr', [...ascii('nclx'), ...u16(1), ...u16(transfer), ...u16(1), 0x80]);

function visualEntry(fourcc: string, w: number, h: number, children: number[] = []): number[] {
  const fixed = [
    ...zeros(6), ...u16(1), // reserved + data_reference_index
    ...u16(0), ...u16(0), ...zeros(12), // pre_defined + reserved + pre_defined[3]
    ...u16(w), ...u16(h),
    ...u32(0x00480000), ...u32(0x00480000), ...u32(0),
    ...u16(1), ...zeros(32), ...u16(0x18), ...u16(0xffff),
  ];
  return box(fourcc, [...fixed, ...children]);
}

const audioEntry = (fourcc: string): number[] => box(fourcc, zeros(28));

const stsd = (entry: number[]): number[] => box('stsd', [0, 0, 0, 0, ...u32(1), ...entry]);
const stts = (samples: number, delta: number): number[] =>
  box('stts', [0, 0, 0, 0, ...u32(1), ...u32(samples), ...u32(delta)]);

function stbl(entry: number[], samples: number, delta: number): number[] {
  return box('stbl', [...stsd(entry), ...stts(samples, delta)]);
}

function videoTrak(opts: {
  fourcc: string; w: number; h: number; timescale: number; duration: number;
  samples: number; colrTransfer?: number;
}): number[] {
  const children = opts.colrTransfer !== undefined ? colr(opts.colrTransfer) : [];
  const delta = Math.round(opts.duration / opts.samples);
  const minf = box('minf', stbl(visualEntry(opts.fourcc, opts.w, opts.h, children), opts.samples, delta));
  const mdia = box('mdia', [...mdhd(opts.timescale, opts.duration), ...hdlr('vide'), ...minf]);
  return box('trak', mdia);
}

function audioTrak(fourcc: string): number[] {
  const minf = box('minf', stbl(audioEntry(fourcc), 100, 1024));
  const mdia = box('mdia', [...mdhd(48000, 4800000), ...hdlr('soun'), ...minf]);
  return box('trak', mdia);
}

function moovFile(traks: number[][]): Uint8Array {
  const ftyp = box('ftyp', [...ascii('isom'), ...u32(0x200), ...ascii('isomiso2mp41')]);
  const moov = box('moov', traks.flat());
  const mdat = box('mdat', zeros(16));
  return new Uint8Array([...ftyp, ...moov, ...mdat]);
}

describe('parseMp4Info', () => {
  it('parses an H.264 video track and AAC audio track with resolution', () => {
    const bytes = moovFile([
      videoTrak({ fourcc: 'avc1', w: 1920, h: 1080, timescale: 24000, duration: 240000, samples: 240 }),
      audioTrak('mp4a'),
    ]);
    const info = parseMp4Info(bytes);
    expect(info).not.toBeNull();
    expect(info!.videoCodec).toBe('avc1');
    expect(info!.audioCodec).toBe('mp4a');
    expect(info!.width).toBe(1920);
    expect(info!.height).toBe(1080);
    expect(info!.fps).toBeCloseTo(24, 5); // 240 samples / (240000/24000 = 10s)
    expect(info!.hdr).toBe('');
  });

  it('reads HDR transfer characteristics from colr (PQ)', () => {
    const bytes = moovFile([
      videoTrak({ fourcc: 'hvc1', w: 3840, h: 2160, timescale: 30000, duration: 300000, samples: 300, colrTransfer: 16 }),
    ]);
    const info = parseMp4Info(bytes);
    expect(info!.videoCodec).toBe('hvc1');
    expect(info!.hdr).toBe('PQ');
  });

  it('maps HLG transfer characteristics (18) to HLG', () => {
    const bytes = moovFile([
      videoTrak({ fourcc: 'av01', w: 3840, h: 2160, timescale: 24000, duration: 240000, samples: 240, colrTransfer: 18 }),
    ]);
    const info = parseMp4Info(bytes);
    expect(info!.videoCodec).toBe('av01');
    expect(info!.hdr).toBe('HLG');
  });

  it('finds moov even when it does not start at offset 0 (tail buffer)', () => {
    const trak = videoTrak({ fourcc: 'avc1', w: 1280, h: 720, timescale: 24000, duration: 120000, samples: 120 });
    const moov = box('moov', trak);
    // Simulate a tail range that starts mid-mdat: junk prefix that is not a valid box.
    const junk = [0xff, 0xff, 0xff, 0xf0, ...ascii('mdat'), ...zeros(40)];
    const bytes = new Uint8Array([...junk, ...moov]);
    const info = parseMp4Info(bytes);
    expect(info).not.toBeNull();
    expect(info!.width).toBe(1280);
    expect(info!.height).toBe(720);
  });

  it('returns null for truncated / garbage input', () => {
    expect(parseMp4Info(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(parseMp4Info(new Uint8Array(0))).toBeNull();
  });

  it('returns null when no video track is present', () => {
    const bytes = moovFile([audioTrak('mp4a')]);
    expect(parseMp4Info(bytes)).toBeNull();
  });
});
