import { hdrFromTransfer, type MediaInfo } from '../utils/stream-info';

// Pure ISO-BMFF (MP4/MOV/M4V) header parser for VOD stream info. Walks the box
// tree down to each track's sample description, reading only what the video
// element cannot expose on webOS: codec fourCC, HDR transfer, and average fps.
// It stops before the large per-sample tables (stsz/stco), so a front range of
// the file is enough for a fast-start `moov`. Returns null when no video track
// is found (caller falls back to the element's resolution).

const u32at = (b: Uint8Array, o: number): number =>
  b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16at = (b: Uint8Array, o: number): number => (b[o] << 8) + b[o + 1];
const fourccAt = (b: Uint8Array, o: number): string =>
  String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

const isPrintableType = (t: string): boolean => /^[\x20-\x7e]{4}$/.test(t);

type BoxVisitor = (type: string, contentStart: number, contentEnd: number) => void;

// Iterate the boxes in [start, end), invoking `visit` for each. Tolerant of a
// truncated final box (content end is clamped to the buffer) and stops on the
// first structurally invalid header so a mid-buffer walk fails cleanly.
function eachBox(b: Uint8Array, start: number, end: number, visit: BoxVisitor): void {
  let o = start;
  while (o + 8 <= end) {
    const size = u32at(b, o);
    const type = fourccAt(b, o + 4);
    if (!isPrintableType(type)) break;
    if (size !== 0 && size !== 1 && size < 8) break;
    let contentStart = o + 8;
    let boxEnd: number;
    if (size === 1) {
      if (o + 16 > end) break;
      boxEnd = o + u32at(b, o + 8) * 0x100000000 + u32at(b, o + 12);
      contentStart = o + 16;
    } else if (size === 0) {
      boxEnd = end;
    } else {
      boxEnd = o + size;
    }
    visit(type, contentStart, Math.min(boxEnd, end));
    if (boxEnd <= o) break;
    o = boxEnd;
  }
}

type TrackInfo = { kind: 'video' | 'audio'; codec: string; width: number; height: number; fps: number; hdr: string };

function parseSampleEntry(b: Uint8Array, start: number, end: number): { codec: string; width: number; height: number; hdr: string } {
  const codec = start + 8 <= end ? fourccAt(b, start + 4) : '';
  const content = start + 8; // skip the sample-entry box header (size + type)
  let width = 0;
  let height = 0;
  let hdr = '';
  if (content + 26 <= end) {
    width = u16at(b, content + 24);
    height = u16at(b, content + 26);
  }
  // Codec-config child boxes (colr, avcC, hvcC…) follow the 78-byte visual
  // sample-entry fixed fields.
  const childStart = content + 78;
  const entryEnd = Math.min(u32at(b, start) >= 8 ? start + u32at(b, start) : end, end);
  if (childStart < entryEnd) {
    eachBox(b, childStart, entryEnd, (type, cs, ce) => {
      if (type === 'colr' && cs + 8 <= ce && fourccAt(b, cs) === 'nclx') {
        hdr = hdrFromTransfer(u16at(b, cs + 6));
      }
    });
  }
  return { codec, width, height, hdr };
}

function parseStsdCodec(b: Uint8Array, start: number, end: number): { codec: string; width: number; height: number; hdr: string } {
  // stsd content: version+flags (4), entry_count (4), then the first sample entry.
  return parseSampleEntry(b, start + 8, end);
}

function countStttsSamples(b: Uint8Array, start: number, end: number): number {
  if (start + 8 > end) return 0;
  const entryCount = u32at(b, start + 4);
  let total = 0;
  let o = start + 8;
  for (let i = 0; i < entryCount && o + 8 <= end; i++) {
    total += u32at(b, o);
    o += 8;
  }
  return total;
}

function parseMdhd(b: Uint8Array, start: number, end: number): { timescale: number; duration: number } {
  const version = b[start];
  if (version === 1) {
    if (start + 32 > end) return { timescale: 0, duration: 0 };
    return { timescale: u32at(b, start + 20), duration: u32at(b, start + 24) * 0x100000000 + u32at(b, start + 28) };
  }
  if (start + 20 > end) return { timescale: 0, duration: 0 };
  return { timescale: u32at(b, start + 12), duration: u32at(b, start + 16) };
}

function parseTrak(b: Uint8Array, start: number, end: number): TrackInfo | null {
  let handler = '';
  let timescale = 0;
  let duration = 0;
  let codec = '';
  let width = 0;
  let height = 0;
  let hdr = '';
  let samples = 0;

  eachBox(b, start, end, (type, cs, ce) => {
    if (type !== 'mdia') return;
    eachBox(b, cs, ce, (t2, cs2, ce2) => {
      if (t2 === 'hdlr') {
        if (cs2 + 12 <= ce2) handler = fourccAt(b, cs2 + 8);
      } else if (t2 === 'mdhd') {
        ({ timescale, duration } = parseMdhd(b, cs2, ce2));
      } else if (t2 === 'minf') {
        eachBox(b, cs2, ce2, (t3, cs3, ce3) => {
          if (t3 !== 'stbl') return;
          eachBox(b, cs3, ce3, (t4, cs4, ce4) => {
            if (t4 === 'stsd') ({ codec, width, height, hdr } = parseStsdCodec(b, cs4, ce4));
            else if (t4 === 'stts') samples = countStttsSamples(b, cs4, ce4);
          });
        });
      }
    });
  });

  const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : null;
  if (!kind || !codec) return null;
  const fps = kind === 'video' && samples > 0 && duration > 0 && timescale > 0 ? (samples * timescale) / duration : 0;
  return { kind, codec, width, height, hdr, fps };
}

function parseMoov(b: Uint8Array, start: number, end: number): MediaInfo | null {
  const info: MediaInfo = { videoCodec: '', audioCodec: '', width: 0, height: 0, fps: 0, hdr: '' };
  let hasVideo = false;
  eachBox(b, start, end, (type, cs, ce) => {
    if (type !== 'trak') return;
    const t = parseTrak(b, cs, ce);
    if (!t) return;
    if (t.kind === 'video' && !hasVideo) {
      hasVideo = true;
      info.videoCodec = t.codec;
      info.width = t.width;
      info.height = t.height;
      info.fps = t.fps;
      info.hdr = t.hdr;
    } else if (t.kind === 'audio' && !info.audioCodec) {
      info.audioCodec = t.codec;
    }
  });
  return hasVideo ? info : null;
}

function locateMoov(b: Uint8Array): { start: number; end: number } | null {
  let found: { start: number; end: number } | null = null;
  eachBox(b, 0, b.length, (type, cs, ce) => {
    if (type === 'moov' && !found) found = { start: cs, end: ce };
  });
  if (found) return found;
  // Tail buffer: it may start mid-`mdat`, so scan for the `moov` fourCC and take
  // the size from the 4 bytes before it.
  for (let i = 4; i + 8 <= b.length; i++) {
    if (b[i] === 0x6d && b[i + 1] === 0x6f && b[i + 2] === 0x6f && b[i + 3] === 0x76) {
      const size = u32at(b, i - 4);
      if (size >= 8) {
        const end = size === 0 ? b.length : Math.min(i - 4 + size, b.length);
        return { start: i + 4, end };
      }
    }
  }
  return null;
}

export function parseMp4Info(bytes: Uint8Array): MediaInfo | null {
  if (bytes.length < 16) return null;
  const moov = locateMoov(bytes);
  if (!moov) return null;
  return parseMoov(bytes, moov.start, moov.end);
}
