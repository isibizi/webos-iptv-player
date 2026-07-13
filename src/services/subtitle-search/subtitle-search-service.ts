import type { SubtitleProvider, SubtitleQuery, OnlineSubtitleResult, SubtitleText } from './types';
import { StorageService } from '../storage-service';
import { createSubdlProvider } from './subdl-provider';
import { createOpenSubtitlesProvider } from './opensubtitles-provider';
import { createAssrtProvider } from './assrt-provider';
import { createLogger } from '../../utils/logger';

const log = createLogger('SubSearch');

function buildProviders(): SubtitleProvider[] {
  const subdl = createSubdlProvider(() => StorageService.getOnlineSubtitleConfig().subdl.apiKey);
  const os = createOpenSubtitlesProvider({
    getApiKey: () => StorageService.getOnlineSubtitleConfig().opensubtitles.apiKey,
    getCredentials: () => {
      const o = StorageService.getOnlineSubtitleConfig().opensubtitles;
      return { username: o.username, password: o.password };
    },
    getToken: () => StorageService.getOnlineSubtitleConfig().opensubtitles.token,
    setToken: (token) => {
      const cfg = StorageService.getOnlineSubtitleConfig();
      cfg.opensubtitles.token = token;
      cfg.opensubtitles.tokenTs = Date.now();
      StorageService.setOnlineSubtitleConfig(cfg);
    },
  });
  const assrt = createAssrtProvider(() => StorageService.getOnlineSubtitleConfig().assrt.apiKey);
  return [os, subdl, assrt]; // order defines the tie-break precedence
}

function langMatches(resultLang: string, preferred: string): boolean {
  if (!preferred) return false;
  const base = (s: string) => s.toLowerCase().split('-')[0];
  return base(resultLang) === base(preferred);
}

class SubtitleSearchService {
  private providers: SubtitleProvider[] = buildProviders();

  /** @internal test seam */
  __setProvidersForTest(p: SubtitleProvider[]): void { this.providers = p; }

  private configured(): SubtitleProvider[] { return this.providers.filter((p) => p.isConfigured()); }

  isAvailable(): boolean { return this.configured().length > 0; }

  preferredLanguage(): string { return StorageService.getOnlineSubtitleConfig().preferredLanguage; }

  async search(q: SubtitleQuery): Promise<OnlineSubtitleResult[]> {
    const providers = this.configured();
    const settled = await Promise.all(providers.map(async (p) => {
      try { return await p.search(q); }
      catch (e) { log.warn(p.id, 'search failed:', e); return [] as OnlineSubtitleResult[]; }
    }));
    const merged = settled.reduce<OnlineSubtitleResult[]>((acc, arr) => acc.concat(arr), []);
    const pref = this.preferredLanguage();
    const rank = (x: OnlineSubtitleResult) => (langMatches(x.language, pref) ? 0 : 1);
    const providerOrder = (x: OnlineSubtitleResult) => this.providers.findIndex((p) => p.id === x.providerId);
    return merged.sort((a, b) => rank(a) - rank(b) || b.downloads - a.downloads || providerOrder(a) - providerOrder(b));
  }

  download(r: OnlineSubtitleResult): Promise<SubtitleText> {
    const p = this.providers.find((x) => x.id === r.providerId);
    if (!p) return Promise.reject(new Error(`no provider ${r.providerId}`));
    return p.download(r);
  }
}

export const subtitleSearchService = new SubtitleSearchService();
