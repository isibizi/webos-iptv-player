import { describe, it, expect, beforeEach, vi } from 'vitest';

const { fetchTextMock } = vi.hoisted(() => ({ fetchTextMock: vi.fn() }));
vi.mock('../utils/fetch-helper', () => ({ fetchText: fetchTextMock }));

import { createXtreamClient } from './xtream-client';

const creds = { baseUrl: 'http://host:8080', username: 'u1', password: 'p1' };

beforeEach(() => vi.clearAllMocks());

describe('XtreamClient.getAccountInfo', () => {
  it('queries the base player_api.php endpoint (no action)', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({ user_info: { auth: 1 } }));
    await createXtreamClient(creds).getAccountInfo();
    expect(fetchTextMock).toHaveBeenCalledWith(
      'http://host:8080/player_api.php?username=u1&password=p1',
      expect.any(Number),
    );
  });

  it('parses an active account', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({
      user_info: {
        auth: 1,
        status: 'Active',
        exp_date: '1700000000',
        max_connections: '2',
        active_cons: '1',
      },
    }));
    expect(await createXtreamClient(creds).getAccountInfo()).toEqual({
      auth: true,
      status: 'Active',
      expiresAt: 1700000000,
      maxConnections: 2,
      activeConnections: 1,
    });
  });

  // Mirrors the authentic XUI.one player_api.php payload: a fat object with a
  // string/int type mix (auth + active_cons are ints; exp_date/max_connections
  // are strings) and many sibling fields we must ignore. Identifiers stay
  // synthetic per the repo convention.
  it('parses an authentic full payload (int active_cons, extra fields ignored)', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({
      user_info: {
        username: 'u1', password: 'p1', message: 'Welcome',
        auth: 1, status: 'Active', exp_date: '1700000000', is_trial: '0',
        active_cons: 0, created_at: '1690000000', max_connections: '5',
        allowed_output_formats: ['ts', 'm3u8', 'rtmp'],
      },
      server_info: { url: 'host', port: '8080', timezone: 'UTC' },
    }));
    expect(await createXtreamClient(creds).getAccountInfo()).toEqual({
      auth: true,
      status: 'Active',
      expiresAt: 1700000000,
      maxConnections: 5,
      activeConnections: 0,
    });
  });

  it('reports auth:0 as a failed login (not null)', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({ user_info: { auth: 0 } }));
    const info = await createXtreamClient(creds).getAccountInfo();
    expect(info).not.toBeNull();
    expect(info!.auth).toBe(false);
  });

  it('treats a null exp_date as unlimited', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({
      user_info: { auth: 1, status: 'Active', exp_date: null, max_connections: '1', active_cons: '0' },
    }));
    const info = await createXtreamClient(creds).getAccountInfo();
    expect(info!.expiresAt).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    fetchTextMock.mockResolvedValue('<html>not json</html>');
    expect(await createXtreamClient(creds).getAccountInfo()).toBeNull();
  });

  it('returns null when user_info is missing', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({ server_info: {} }));
    expect(await createXtreamClient(creds).getAccountInfo()).toBeNull();
  });

  it('returns null on a network error', async () => {
    fetchTextMock.mockRejectedValue(new Error('timeout'));
    expect(await createXtreamClient(creds).getAccountInfo()).toBeNull();
  });
});
