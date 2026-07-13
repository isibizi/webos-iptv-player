import { createLogger } from './logger';

const log = createLogger('SubDecode');

/** Decode subtitle bytes to text. Chinese subtitles are frequently GB18030/GBK,
 *  not UTF-8, so try strict UTF-8 first and fall back to GB18030 (a GBK/GB2312
 *  superset) on failure. A leading BOM is stripped. */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      text = new TextDecoder('gb18030').decode(bytes);
    } catch (e) {
      log.warn('decode failed, using lenient utf-8:', e);
      text = new TextDecoder('utf-8').decode(bytes);
    }
  }
  return text.replace(/^\uFEFF/, '');
}
