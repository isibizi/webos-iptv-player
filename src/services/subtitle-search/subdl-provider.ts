import type { SubtitleProvider, SubtitleQuery, OnlineSubtitleResult, SubtitleText } from './types';
import { formatFromName } from './types';
import { fetchWithTimeout } from '../../utils/fetch-helper';
import { firstSubtitleFromZip } from '../../utils/unzip';
import { createLogger } from '../../utils/logger';

const log = createLogger('SubDL');
const SEARCH = 'https://api.subdl.com/api/v1/subtitles';
const DL = 'https://dl.subdl.com';

export function createSubdlProvider(getApiKey: () => string): SubtitleProvider {
  return {
    id: 'subdl',
    label: 'SubDL',
    isConfigured: () => getApiKey().trim() !== '',

    async search(q: SubtitleQuery): Promise<OnlineSubtitleResult[]> {
      const p = new URLSearchParams();
      p.set('api_key', getApiKey());
      p.set('subs_per_page', '30');
      p.set('type', q.type === 'episode' ? 'tv' : 'movie');
      if (q.manualQuery) p.set('film_name', q.manualQuery);
      else if (q.imdbId) p.set('imdb_id', `tt${q.imdbId}`);
      else if (q.tmdbId) p.set('tmdb_id', q.tmdbId);
      else {
        p.set('film_name', q.title);
        if (q.year) p.set('year', String(q.year));
      }
      if (q.type === 'episode') {
        if (q.season != null) p.set('season_number', String(q.season));
        if (q.episode != null) p.set('episode_number', String(q.episode));
      }
      try {
        const res = await fetchWithTimeout(`${SEARCH}?${p.toString()}`);
        const body = await res.json() as { subtitles?: Array<Record<string, unknown>> };
        return (body.subtitles ?? []).map((s) => {
          const name = String(s.name ?? '');
          const url = String(s.url ?? '');
          return {
            providerId: 'subdl' as const,
            id: url,
            language: String(s.language ?? ''),
            releaseName: String(s.release_name ?? name),
            fileName: name,
            format: formatFromName(name || url),
            hearingImpaired: s.hi === true,
            downloads: 0,
          };
        }).filter((r) => r.id !== '');
      } catch (e) {
        log.warn('search failed:', e);
        return [];
      }
    },

    async download(r: OnlineSubtitleResult): Promise<SubtitleText> {
      const url = r.id.startsWith('http') ? r.id : `${DL}${r.id}`;
      const res = await fetchWithTimeout(url);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const file = await firstSubtitleFromZip(bytes);
      if (!file) throw new Error('SubDL: no subtitle in archive');
      return { text: file.text, format: formatFromName(file.name) };
    },
  };
}
