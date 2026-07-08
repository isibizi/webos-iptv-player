import { hdrFromTransfer, type MediaInfo } from '../utils/stream-info';

// Pure MKV/WebM (EBML) header parser for VOD stream info. Reads the Tracks
// element near the front of the Segment for codec, resolution, HDR transfer and
// (when present) frame rate. Never scans Clusters, so a front range of the file
// is enough. Returns null when no video track is found.

// EBML CodecID → RFC-6381 fourCC key so codecName() is reused for the label.
const MKV_CODECS: Record<string, string> = {
  'V_MPEG4/ISO/AVC': 'avc1',
  'V_MPEGH/ISO/HEVC': 'hvc1',
  'V_AV1': 'av01',
  'V_VP9': 'vp09',
  'V_VP8': 'vp08',
  'V_MPEG4/ISO/ASP': 'mp4v',
  'A_AAC': 'mp4a',
  'A_AC3': 'ac-3',
  'A_EAC3': 'ec-3',
  'A_DTS': 'dtsc',
  'A_OPUS': 'opus',
  'A_FLAC': 'flac',
  'A_TRUEHD': 'mlpa',
  'A_MLP': 'mlpa',
  'A_MPEG/L3': 'mp3',
};

function mkvCodecToFourcc(id: string): string {
  const key = id.trim().toUpperCase();
  if (MKV_CODECS[key]) return MKV_CODECS[key];
  for (const prefix of Object.keys(MKV_CODECS)) {
    if (key.startsWith(prefix)) return MKV_CODECS[prefix];
  }
  return '';
}

const EL = {
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackType: 0x83,
  CodecID: 0x86,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Colour: 0x55b0,
  TransferCharacteristics: 0x55ba,
};

// Length of a vint from its first byte: the position of the leading set bit.
function vintLength(first: number): number {
  for (let i = 0; i < 8; i++) {
    if (first & (0x80 >> i)) return i + 1;
  }
  return 0;
}

type ElementVisitor = (id: number, dataStart: number, dataEnd: number) => void;

// Iterate EBML elements in [start, end). Element IDs keep their marker bits (so
// they match the EL constants); sizes have the marker cleared. An unknown-size
// element (all size bits set, e.g. a live Segment) spans to `end`.
function eachElement(b: Uint8Array, start: number, end: number, visit: ElementVisitor): void {
  let o = start;
  while (o < end) {
    const idLen = vintLength(b[o]);
    if (idLen === 0 || o + idLen > end) break;
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + b[o + i];
    let p = o + idLen;
    if (p >= end) break;
    const sizeLen = vintLength(b[p]);
    if (sizeLen === 0 || p + sizeLen > end) break;
    let size = b[p] & (0xff >> sizeLen);
    let unknown = size === (0xff >> sizeLen);
    for (let i = 1; i < sizeLen; i++) {
      size = size * 256 + b[p + i];
      if (b[p + i] !== 0xff) unknown = false;
    }
    const dataStart = p + sizeLen;
    const dataEnd = unknown ? end : Math.min(dataStart + size, end);
    visit(id, dataStart, dataEnd);
    if (dataEnd <= o) break;
    o = dataEnd;
  }
}

function readUint(b: Uint8Array, start: number, end: number): number {
  let v = 0;
  for (let o = start; o < end; o++) v = v * 256 + b[o];
  return v;
}

function readString(b: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let o = start; o < end; o++) {
    if (b[o] === 0) break;
    s += String.fromCharCode(b[o]);
  }
  return s;
}

type TrackInfo = { kind: 'video' | 'audio'; codec: string; width: number; height: number; fps: number; hdr: string };

function locateSegment(b: Uint8Array): { start: number; end: number } | null {
  let found: { start: number; end: number } | null = null;
  eachElement(b, 0, b.length, (id, ds, de) => {
    if (id === EL.Segment && !found) found = { start: ds, end: de };
  });
  return found;
}

function parseTrackEntry(b: Uint8Array, start: number, end: number): TrackInfo | null {
  let trackType = 0;
  let codecId = '';
  let width = 0;
  let height = 0;
  let hdr = '';
  let defaultDuration = 0;

  eachElement(b, start, end, (id, ds, de) => {
    if (id === EL.TrackType) trackType = readUint(b, ds, de);
    else if (id === EL.CodecID) codecId = readString(b, ds, de);
    else if (id === EL.DefaultDuration) defaultDuration = readUint(b, ds, de);
    else if (id === EL.Video) {
      eachElement(b, ds, de, (vid, vds, vde) => {
        if (vid === EL.PixelWidth) width = readUint(b, vds, vde);
        else if (vid === EL.PixelHeight) height = readUint(b, vds, vde);
        else if (vid === EL.Colour) {
          eachElement(b, vds, vde, (cid, cds, cde) => {
            if (cid === EL.TransferCharacteristics) hdr = hdrFromTransfer(readUint(b, cds, cde));
          });
        }
      });
    }
  });

  const kind = trackType === 1 ? 'video' : trackType === 2 ? 'audio' : null;
  if (!kind) return null;
  const codec = mkvCodecToFourcc(codecId);
  if (!codec) return null;
  const fps = kind === 'video' && defaultDuration > 0 ? 1e9 / defaultDuration : 0;
  return { kind, codec, width, height, hdr, fps };
}

export function parseMkvInfo(bytes: Uint8Array): MediaInfo | null {
  const segment = locateSegment(bytes);
  if (!segment) return null;

  const info: MediaInfo = { videoCodec: '', audioCodec: '', width: 0, height: 0, fps: 0, hdr: '' };
  let hasVideo = false;
  eachElement(bytes, segment.start, segment.end, (id, ds, de) => {
    if (id !== EL.Tracks) return;
    eachElement(bytes, ds, de, (tid, tds, tde) => {
      if (tid !== EL.TrackEntry) return;
      const t = parseTrackEntry(bytes, tds, tde);
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
  });
  return hasVideo ? info : null;
}
