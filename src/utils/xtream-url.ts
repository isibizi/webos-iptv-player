// Pure URL derivation for an Xtream Codes / XUI.one portal. A single set of
// credentials (base portal URL + username + password) yields the get.php
// playlist, xmltv.php EPG, and player_api.php JSON endpoints. Kept dependency-
// free and unit-tested so the stateful client/service layers just compose it.

export interface XtreamCredentials {
  /** Portal base, e.g. `http://host:8080`. Normalized lazily by each builder. */
  baseUrl: string;
  username: string;
  password: string;
}

/** `scheme://host[:port][/path]` with a default http scheme and no trailing slash. */
export function normalizeXtreamBaseUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

function creds({ username, password }: XtreamCredentials): string {
  return `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

/** M3U playlist (live + VOD + series, flattened). `output=ts` keeps live on the
 *  native pipeline; everything downstream is the existing M3U path. */
export function xtreamPlaylistUrl(c: XtreamCredentials): string {
  return `${normalizeXtreamBaseUrl(c.baseUrl)}/get.php?${creds(c)}&type=m3u_plus&output=ts`;
}

/** XMLTV EPG feed. */
export function xtreamEpgUrl(c: XtreamCredentials): string {
  return `${normalizeXtreamBaseUrl(c.baseUrl)}/xmltv.php?${creds(c)}`;
}

/** player_api.php JSON endpoint. Base call (no action) returns account/server
 *  info; an action plus optional params drives the catalog calls. */
export function xtreamPlayerApi(
  c: XtreamCredentials,
  action?: string,
  params?: Record<string, string | number>,
): string {
  let url = `${normalizeXtreamBaseUrl(c.baseUrl)}/player_api.php?${creds(c)}`;
  if (action) url += `&action=${encodeURIComponent(action)}`;
  if (params) {
    for (const key in params) {
      url += `&${key}=${encodeURIComponent(params[key])}`;
    }
  }
  return url;
}

/** VOD (movie) stream URL: `{base}/movie/{user}/{pass}/{streamId}.{ext}`.
 *  Played by the native pipeline; container_extension comes from the catalog. */
export function xtreamVodUrl(c: XtreamCredentials, streamId: string, ext: string): string {
  const base = normalizeXtreamBaseUrl(c.baseUrl);
  return `${base}/movie/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${streamId}.${ext}`;
}

/** Series episode stream URL: `{base}/series/{user}/{pass}/{episodeId}.{ext}`. */
export function xtreamEpisodeUrl(c: XtreamCredentials, episodeId: string, ext: string): string {
  const base = normalizeXtreamBaseUrl(c.baseUrl);
  return `${base}/series/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${episodeId}.${ext}`;
}
