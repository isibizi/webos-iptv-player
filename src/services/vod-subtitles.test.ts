import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { fetchTextMock } = vi.hoisted(() => ({ fetchTextMock: vi.fn() }));
vi.mock('../utils/fetch-helper', () => ({ fetchText: fetchTextMock }));

import { VodSubtitles } from './vod-subtitles';

// jsdom exposes neither VTTCue nor <track>.track, so the DOM-building `attach`
// is covered by e2e; here we exercise `ensureLoaded`'s load/parse/guard logic by
// stubbing VTTCue and seeding the private entries (the private-injection pattern
// used across these tests). A cue captures its constructor args for assertions.
class FakeVTTCue {
  constructor(public startTime: number, public endTime: number, public text: string) {}
}

interface FakeTrack { cues: FakeVTTCue[]; addCue(c: FakeVTTCue): void }
const makeTrack = (): FakeTrack => ({ cues: [], addCue(c) { this.cues.push(c); } });

type Entry = { track: FakeTrack; url: string; loaded: boolean };
const seed = (subs: VodSubtitles, entries: Entry[], gen = 1) => {
  (subs as unknown as { entries: Entry[]; gen: number }).entries = entries;
  (subs as unknown as { entries: Entry[]; gen: number }).gen = gen;
};
const entriesOf = (subs: VodSubtitles) => (subs as unknown as { entries: Entry[] }).entries;
const genOf = (subs: VodSubtitles) => (subs as unknown as { gen: number }).gen;

let subs: VodSubtitles;
let track: FakeTrack;

beforeEach(() => {
  vi.stubGlobal('VTTCue', FakeVTTCue);
  fetchTextMock.mockReset();
  subs = new VodSubtitles();
  track = makeTrack();
});
afterEach(() => vi.unstubAllGlobals());

describe('VodSubtitles.ensureLoaded', () => {
  it('fetches, converts an SRT sidecar and adds its cues to the track', async () => {
    seed(subs, [{ track, url: 'http://host/a.srt', loaded: false }]);
    fetchTextMock.mockResolvedValue('1\n00:00:01,000 --> 00:00:02,500\nHi\n');
    await subs.ensureLoaded(track as unknown as TextTrack);
    expect(track.cues).toEqual([{ startTime: 1, endTime: 2.5, text: 'Hi' }]);
  });

  it('adds cues from a WebVTT sidecar directly', async () => {
    seed(subs, [{ track, url: 'http://host/a.vtt', loaded: false }]);
    fetchTextMock.mockResolvedValue('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n');
    await subs.ensureLoaded(track as unknown as TextTrack);
    expect(track.cues).toEqual([{ startTime: 1, endTime: 2, text: 'Hi' }]);
  });

  it('loads each track only once (repeat shows do not refetch)', async () => {
    seed(subs, [{ track, url: 'http://host/a.vtt', loaded: false }]);
    fetchTextMock.mockResolvedValue('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n');
    await subs.ensureLoaded(track as unknown as TextTrack);
    await subs.ensureLoaded(track as unknown as TextTrack);
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(track.cues).toHaveLength(1);
  });

  it('drops cues when the generation changes mid-fetch (a new item was attached)', async () => {
    seed(subs, [{ track, url: 'http://host/a.vtt', loaded: false }], 1);
    fetchTextMock.mockImplementation(async () => {
      (subs as unknown as { gen: number }).gen = 2; // simulate a re-attach during the fetch
      return 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    });
    await subs.ensureLoaded(track as unknown as TextTrack);
    expect(track.cues).toHaveLength(0);
  });

  it('resets the loaded flag on failure so a later show can retry', async () => {
    seed(subs, [{ track, url: 'http://host/a.vtt', loaded: false }]);
    fetchTextMock.mockRejectedValueOnce(new Error('net'));
    await subs.ensureLoaded(track as unknown as TextTrack);
    expect(track.cues).toHaveLength(0);
    expect(entriesOf(subs)[0].loaded).toBe(false);

    fetchTextMock.mockResolvedValueOnce('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n');
    await subs.ensureLoaded(track as unknown as TextTrack);
    expect(track.cues).toHaveLength(1);
  });

  it('is a no-op for a track it does not own', async () => {
    seed(subs, [{ track, url: 'http://host/a.vtt', loaded: false }]);
    await subs.ensureLoaded(makeTrack() as unknown as TextTrack);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });
});

describe('VodSubtitles.clear', () => {
  it('drops the entries and bumps the generation (cancels in-flight loads)', () => {
    seed(subs, [{ track, url: 'http://host/a.vtt', loaded: true }], 5);
    subs.clear();
    expect(entriesOf(subs)).toEqual([]);
    expect(genOf(subs)).toBe(6);
  });
});

describe('VodSubtitles.addOnline (in-memory text)', () => {
  it('uses preloaded text instead of fetching when entry.text is present', async () => {
    const t = makeTrack();
    seed(subs, [{ track: t, url: '', text: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nhi\n', loaded: false } as unknown as Entry]);
    await subs.ensureLoaded(t as unknown as TextTrack);
    expect(fetchTextMock).not.toHaveBeenCalled();
    expect(t.cues).toEqual([{ startTime: 1, endTime: 2, text: 'hi' }]);
  });
});
