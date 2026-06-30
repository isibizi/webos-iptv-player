import type { SubtitleOption, SubtitlePref, ManifestSubtitle, ManifestClosedCaption } from '../types';
import ISO6391 from 'iso-639-1';
import { iso6392BTo1 } from 'iso-639-2/2b-to-1';
import { iso6392TTo1 } from 'iso-639-2/2t-to-1';

// The hls.js subtitle-track fields we read, structural to avoid an hls.js type dep.
export interface HlsSubtitleTrackLike {
  name?: string;
  lang?: string;
  default?: boolean;
  forced?: boolean;
}

// Endonym for a language code (so a NAME-less track reads "Deutsch", not "de"), via
// `iso-639-1` (2-letter native names) + `iso-639-2` to fold 3-letter codes (deu/ger → de).
// Anything unknown falls through to the raw code. The TV's fonts render these scripts —
// `LG Smart UI` covers Latin/Cyrillic/Greek/Korean directly, `LG Display` (system fallback)
// covers CJK/Arabic/Hebrew/Thai — 中文 confirmed on-device.
export function languageName(lang: string): string {
  const code = lang.toLowerCase().split('-')[0];
  const two = code.length === 3 ? (iso6392BTo1[code] || iso6392TTo1[code]) : code;
  return (two && ISO6391.getNativeName(two)) || lang;
}

/** Display label for a subtitle: its name, then the language (as an endonym when known),
 *  then a positional fallback. */
export function subtitleLabel(opt: SubtitleOption): string {
  if (opt.name) return opt.name;
  if (opt.lang) return languageName(opt.lang);
  return `Subtitle ${opt.index + 1}`;
}

/** Normalize hls.js subtitle renditions. `currentIdx` is hls.subtitleTrack (-1 = off). */
export function hlsSubtitleOptions(tracks: readonly HlsSubtitleTrackLike[], currentIdx: number): SubtitleOption[] {
  return tracks.map((t, index) => ({
    index,
    name: t.name || '',
    lang: t.lang || '',
    isDefault: !!t.default,
    isForced: !!t.forced,
    active: index === currentIdx,
  }));
}

/** Normalize the native HTMLMediaElement.textTracks list — subtitle/caption kinds
 *  only. `index` stays the position in the full list so it can drive `.mode`. */
export function nativeSubtitleOptions(list: TextTrackList): SubtitleOption[] {
  const out: SubtitleOption[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind && t.kind !== 'subtitles' && t.kind !== 'captions') continue;
    const lang = t.language && t.language !== 'und' ? t.language : '';
    out.push({ index: i, name: t.label || '', lang, isDefault: false, isForced: false, active: t.mode === 'showing' });
  }
  return out;
}

/** Pick a subtitle index for `options`, or -1 for off. Honors an explicit "off"
 *  pref, else matches by name then language; with no usable pref the stream
 *  default is the forced track if any, otherwise off (subtitles stay off). */
export function chooseSubtitleIndex(options: SubtitleOption[], pref: SubtitlePref | null): number {
  if (pref) {
    if (pref.off) return -1;
    const byName = pref.name && options.find(o => o.name.toLowerCase() === pref.name.toLowerCase());
    if (byName) return byName.index;
    const byLang = pref.lang && options.find(o => o.lang.toLowerCase() === pref.lang.toLowerCase());
    if (byLang) return byLang.index;
  }
  const forced = options.find(o => o.isForced);
  return forced ? forced.index : -1;
}

/** Whether `pref` actually matched `opt` by name/language (vs. off / a fallback). */
export function isSubtitlePrefMatch(opt: SubtitleOption | undefined, pref: SubtitlePref | null): boolean {
  return !!pref && !pref.off && !!opt
    && ((!!pref.name && opt.name.toLowerCase() === pref.name.toLowerCase())
      || (!!pref.lang && opt.lang.toLowerCase() === pref.lang.toLowerCase()));
}

// Parse the EXT-X-MEDIA:TYPE=SUBTITLES renditions from an HLS master playlist, in
// declaration order, deduped by name+language. Native textTracks can expose these
// with empty name/language, so the manifest is the source of real names on-device.
export function parseSubtitleRenditions(manifest: string): ManifestSubtitle[] {
  const out: ManifestSubtitle[] = [];
  const seen = new Set<string>();
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-MEDIA:') || !/TYPE=SUBTITLES(?:,|$)/.test(line)) continue;
    // Anchor each attribute on a `:`/`,` (+ optional space) so LANGUAGE doesn't match
    // ASSOC-LANGUAGE and a packager's `, NAME="…"` spacing doesn't drop the value.
    const attr = (k: string): string => line.match(new RegExp(`[:,]\\s*${k}="([^"]*)"`))?.[1] ?? '';
    const name = attr('NAME');
    const lang = attr('LANGUAGE');
    const key = JSON.stringify([name, lang]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      lang,
      isDefault: /[:,]DEFAULT=YES(?:,|$)/.test(line),
      isForced: /[:,]FORCED=YES(?:,|$)/.test(line),
    });
  }
  return out;
}

// Parse the EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS declarations from an HLS master, in
// order, deduped by INSTREAM-ID (CC1-4 = CEA-608, SERVICE1-63 = CEA-708). Unlike
// SUBTITLES these have no URI — they ride inside the video ES — so the manifest is
// the only place the app can learn a stream advertises captions.
export function parseClosedCaptions(manifest: string): ManifestClosedCaption[] {
  const out: ManifestClosedCaption[] = [];
  const seen = new Set<string>();
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-MEDIA:') || !/TYPE=CLOSED-CAPTIONS(?:,|$)/.test(line)) continue;
    const attr = (k: string): string => line.match(new RegExp(`[:,]\\s*${k}="([^"]*)"`))?.[1] ?? '';
    const instreamId = attr('INSTREAM-ID');
    const name = attr('NAME');
    const lang = attr('LANGUAGE');
    const key = JSON.stringify([name, lang, instreamId]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lang, instreamId, isDefault: /[:,]DEFAULT=YES(?:,|$)/.test(line) });
  }
  return out;
}

/** Picker label for the single closed-caption toggle. Channel selection isn't
 *  possible (selectTrack decode-freezes the video on webOS), so several declared
 *  tracks collapse to one on/off entry — named only when there's exactly one. */
export function closedCaptionLabel(ccs: ManifestClosedCaption[]): string {
  return ccs.length === 1 && ccs[0].name ? ccs[0].name : 'Closed Captions';
}

/** Overlay manifest names/languages (and the default/forced flags native tracks
 *  can't carry) onto native subtitle options, by index. Only applies when the
 *  counts line up, so a partial native list isn't mislabeled. */
export function mergeSubtitleManifestNames(opts: SubtitleOption[], manifest: ManifestSubtitle[]): SubtitleOption[] {
  if (!manifest.length || manifest.length !== opts.length) return opts;
  return opts.map((o, i) => ({
    ...o,
    name: manifest[i].name || o.name,
    lang: manifest[i].lang || o.lang,
    isDefault: manifest[i].isDefault,
    isForced: manifest[i].isForced,
  }));
}
