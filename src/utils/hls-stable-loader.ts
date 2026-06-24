// Make hls.js as lenient as the native player about non-conformant live windows.
// Some proxies serve the *same* segment from a rotating host/path on every
// reload; hls.js (correctly per RFC 8216) rejects that as a "media sequence
// mismatch" because the URI for a given sequence number changed. We give hls.js
// a stable sliding window: rewrite each segment URI to a fixed form keyed by its
// sequence number (so the overlap check always matches) and stash the real URL
// in a query string — which hls.js strips before comparing but keeps for the
// actual load. A fragment loader then maps the stable URI back to the real one.
type HlsType = typeof import('hls.js').default;

const STABLE_HOST = 'http://hls-stable.invalid/';
const REAL_PARAM = '__real=';

export function stabilizeManifest(text: string, baseUrl?: string): string {
  // Only media playlists have the sliding window; leave master/other untouched.
  if (text.indexOf('#EXTM3U') === -1 || text.indexOf('#EXT-X-STREAM-INF') !== -1) return text;
  const lines = text.split('\n');
  let mediaSeq = 0;
  for (const l of lines) {
    const m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(l.trim());
    if (m) { mediaSeq = parseInt(m[1], 10); break; }
  }
  let i = 0;
  return lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line; // tags + blanks pass through
    const sn = mediaSeq + i++; // each URI line is the next media segment
    // Resolve relative segment URIs against the playlist URL — hls.js would
    // normally resolve them against the playlist base, which our rewrite bypasses.
    let real = t;
    if (baseUrl) { try { real = new URL(t, baseUrl).href; } catch { /* keep raw */ } }
    return `${STABLE_HOST}${sn}.ts?${REAL_PARAM}${encodeURIComponent(real)}`;
  }).join('\n');
}

let lenientLoaders: { pLoader: unknown; fLoader: unknown } | null = null;

// Build hls.js pLoader/fLoader: the playlist loader stabilizes each refresh, the
// fragment loader maps the stable URI back to the real one before fetching.
// Memoised per process (the classes only depend on the Hls constructor).
export function getLenientLoaders(Hls: HlsType): { pLoader: unknown; fLoader: unknown } {
  if (lenientLoaders) return lenientLoaders;
  // The hls.js loader is a 3rd-party class we wrap; `any` keeps the override terse.
  const Base: any = (Hls as any).DefaultConfig.loader;
  class PLoader extends Base {
    load(context: any, config: any, callbacks: any): void {
      const onSuccess = callbacks.onSuccess;
      callbacks.onSuccess = (response: any, stats: any, ctx: any, net: any) => {
        if (typeof response.data === 'string') {
          // net.responseURL is the post-redirect URL; fall back to the requested URL.
          const base = (net && net.responseURL) || ctx.url;
          response.data = stabilizeManifest(response.data, base);
        }
        onSuccess(response, stats, ctx, net);
      };
      super.load(context, config, callbacks);
    }
  }
  class FLoader extends Base {
    load(context: any, config: any, callbacks: any): void {
      const u: string = context.url || '';
      const at = u.indexOf(REAL_PARAM);
      if (at !== -1) context.url = decodeURIComponent(u.slice(at + REAL_PARAM.length));
      super.load(context, config, callbacks);
    }
  }
  lenientLoaders = { pLoader: PLoader, fLoader: FLoader };
  return lenientLoaders;
}
