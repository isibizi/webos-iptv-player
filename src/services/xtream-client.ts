import { fetchText } from '../utils/fetch-helper';
import { xtreamPlayerApi, type XtreamCredentials } from '../utils/xtream-url';
import { createLogger } from '../utils/logger';

const log = createLogger('Xtream');

// Account check is an interactive "verify these credentials" call, so fail fast.
const ACCOUNT_INFO_TIMEOUT = 15000;

/** Account status from the portal's `user_info`, normalized for display. */
export interface XtreamAccountInfo {
  /** False = the panel reached us but rejected the credentials (`auth: 0`). */
  auth: boolean;
  status: string;
  /** Unix seconds, or null for an unlimited/non-expiring account. */
  expiresAt: number | null;
  maxConnections: number;
  activeConnections: number;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A per-account handle over the Xtream `player_api.php` JSON endpoint. Flat
 *  composition (no inheritance); catalog methods grow on the same factory. */
export function createXtreamClient(creds: XtreamCredentials) {
  return {
    /** Account status, or null when the panel is unreachable / returns non-JSON. */
    async getAccountInfo(): Promise<XtreamAccountInfo | null> {
      try {
        const text = await fetchText(xtreamPlayerApi(creds), ACCOUNT_INFO_TIMEOUT);
        const data = JSON.parse(text) as { user_info?: Record<string, unknown> };
        const u = data.user_info;
        if (!u) return null;
        const exp = u.exp_date;
        return {
          auth: u.auth === 1 || u.auth === '1' || u.auth === true,
          status: typeof u.status === 'string' ? u.status : '',
          expiresAt: exp === null || exp === undefined || exp === '' ? null : toNumber(exp) || null,
          maxConnections: toNumber(u.max_connections),
          activeConnections: toNumber(u.active_cons),
        };
      } catch (err) {
        log.warn('getAccountInfo failed:', err);
        return null;
      }
    },
  };
}

export type XtreamClient = ReturnType<typeof createXtreamClient>;
