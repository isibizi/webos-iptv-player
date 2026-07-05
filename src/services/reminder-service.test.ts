// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { state, playlistMock } = vi.hoisted(() => {
  const state = { channels: [] as Array<{ url: string; name: string }> };
  return { state, playlistMock: { get channels() { return state.channels; } } };
});
vi.mock('./playlist-service', () => ({ PlaylistService: playlistMock }));

import { ReminderService } from './reminder-service';
import { channelKey } from '../utils/channel';

const chan = (url: string, name: string) => ({
  id: '', name, logo: '', group: '', url, extras: null,
  playlistIds: [], catchup: '', catchupSource: '', catchupDays: 0,
});

const keyA = channelKey(chan('http://host/a', 'A') as never);

beforeEach(() => {
  localStorage.clear();
  state.channels = [chan('http://host/a', 'A'), chan('http://host/b', 'B')] as never[];
});

const rem = (over = {}) => ({ channelKey: keyA, channelName: 'A', title: 'Alpha', startMs: 1000, stopMs: 2000, ...over });

describe('ReminderService store', () => {
  it('adds, detects, and removes a reminder idempotently', () => {
    expect(ReminderService.has(keyA, 1000)).toBe(false);
    ReminderService.add(rem());
    ReminderService.add(rem()); // duplicate ignored
    expect(ReminderService.list()).toHaveLength(1);
    expect(ReminderService.has(keyA, 1000)).toBe(true);
    ReminderService.remove(keyA, 1000);
    expect(ReminderService.has(keyA, 1000)).toBe(false);
  });

  it('resolves a channelKey to its playlist index (-1 if gone)', () => {
    expect(ReminderService.resolveChannelIndex(keyA)).toBe(0);
    expect(ReminderService.resolveChannelIndex('nope')).toBe(-1);
  });

  it('dueNow returns only on-air, unanswered, resolvable reminders', () => {
    ReminderService.add(rem({ startMs: 1000, stopMs: 3000 }));
    expect(ReminderService.dueNow(500)).toHaveLength(0);   // before start
    expect(ReminderService.dueNow(4000)).toHaveLength(0);  // after stop
    expect(ReminderService.dueNow(2000)).toHaveLength(1);  // on air
    ReminderService.markAnswered(keyA, 1000);
    expect(ReminderService.dueNow(2000)).toHaveLength(0);  // answered
  });

  it('prune drops ended reminders and vanished channels', () => {
    ReminderService.add(rem({ startMs: 1000, stopMs: 2000 }));
    ReminderService.add({ channelKey: 'gone', channelName: 'X', title: 'T', startMs: 1000, stopMs: 9000 });
    ReminderService.prune(5000); // first ended, second channel gone
    expect(ReminderService.list()).toHaveLength(0);
  });
});

describe('ReminderService scheduling', () => {
  function mockLuna() {
    const request = vi.fn();
    (window as unknown as { webOS?: unknown }).webOS = { service: { request } };
    return request;
  }
  beforeEach(() => { delete (window as unknown as { webOS?: unknown }).webOS; });

  it('schedules an activity with a createToast callback on add', () => {
    const request = mockLuna();
    const startMs = new Date(2030, 0, 2, 15, 4, 5).getTime();
    ReminderService.add(rem({ startMs, title: 'Alpha' }));
    expect(request).toHaveBeenCalledTimes(1);
    const [uri, opts] = request.mock.calls[0];
    expect(uri).toBe('luna://com.webos.service.activitymanager');
    const a = (opts as { parameters: { activity: Record<string, unknown> } }).parameters.activity;
    expect(a.name).toBe(`iptvReminder-${keyA}-${startMs}`);
    expect(a.schedule as { start: string; local: boolean }).toEqual({ start: '2030-01-02 15:04:05', local: true });
    expect((a.callback as { method: string }).method).toBe('luna://com.webos.notification/createToast');
    expect((a.callback as { params: { message: string } }).params.message).toContain('Alpha');
  });

  it('cancels the activity by name on remove', () => {
    const request = mockLuna();
    ReminderService.add(rem({ startMs: 5000 }));
    request.mockClear();
    ReminderService.remove(keyA, 5000);
    expect(request).toHaveBeenCalledWith('luna://com.webos.service.activitymanager',
      expect.objectContaining({ method: 'cancel', parameters: { activityName: `iptvReminder-${keyA}-5000` } }));
  });

  it('no-ops scheduling when Luna is unavailable', () => {
    ReminderService.add(rem({ startMs: 5000 }));
    expect(ReminderService.has(keyA, 5000)).toBe(true); // still stored
  });
});
