// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlaylistEntry } from '../types';

const { catalogMock, playlistMock } = vi.hoisted(() => ({
  catalogMock: { loadAllVodStreams: vi.fn(), loadAllSeries: vi.fn() },
  playlistMock: { search: vi.fn(() => [] as unknown[]), indexOf: vi.fn(() => 0) },
}));
vi.mock('../services/xtream-catalog', () => catalogMock);
vi.mock('../services/playlist-service', () => ({ PlaylistService: playlistMock }));

import { Search } from './search';
import { CONFIG } from '../config';

const account: PlaylistEntry = {
  id: 'x1', name: 'X', url: 'http://host:8080', source: 'xtream', xtream: { username: 'u', password: 'p' },
};
const vod = (id: string, name: string) => ({ accountId: 'x1', streamId: id, name, poster: '', rating: '', categoryId: '1', containerExtension: 'mp4' });
const ser = (id: string, name: string) => ({ accountId: 'x1', seriesId: id, name, poster: '', rating: '', categoryId: '1' });
const chan = (name: string) => ({ id: name, name, logo: '', group: '', url: `http://host/${name}`, extras: null, playlistIds: ['x1'], catchup: '', catchupSource: '', catchupDays: 0 });

let container: HTMLElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  playlistMock.search.mockReturnValue([]);
  playlistMock.indexOf.mockReturnValue(0);
  container = document.createElement('div');
  document.body.appendChild(container);
});

function mkHandlers() {
  return { onRevealTabBar: vi.fn(), onBack: vi.fn(), onPlayChannel: vi.fn(), onOpenMovie: vi.fn(), onOpenSeries: vi.fn() };
}

async function openWith(opts: { vod?: unknown[]; series?: unknown[] } = {}) {
  catalogMock.loadAllVodStreams.mockResolvedValue(opts.vod ?? []);
  catalogMock.loadAllSeries.mockResolvedValue(opts.series ?? []);
  const handlers = mkHandlers();
  const view = new Search(container, handlers);
  await view.open(account);
  return { view, handlers };
}

describe('Search', () => {
  it('renders results-only and empty on open (no in-view query box, no hint)', async () => {
    await openWith();
    expect(container.querySelector('.search-results')).not.toBeNull();
    expect(container.querySelector('.search-input')).toBeNull(); // the box lives in the tab bar
    // The results view is only shown once a query is typed, so it renders empty.
    expect(container.querySelector('.search-results')?.textContent?.trim()).toBe('');
  });

  it('renders Channels / Movies / Series result rails when the query is set', async () => {
    playlistMock.search.mockReturnValue([chan('Channel One')]);
    const { view } = await openWith({ vod: [vod('10', 'Movie One')], series: [ser('s1', 'Series One')] });
    view.setQuery('one');
    expect(container.querySelector('.catalog-tile[data-channel-index="0"]')?.textContent).toContain('Channel One');
    expect(container.querySelector('.catalog-tile[data-stream-id="10"]')?.textContent).toContain('Movie One');
    expect(container.querySelector('.catalog-tile[data-series-id="s1"]')?.textContent).toContain('Series One');
  });

  it('caps each result group at SEARCH_RESULT_CAP', async () => {
    const cap = CONFIG.XTREAM.SEARCH_RESULT_CAP;
    const many = Array.from({ length: cap + 5 }, (_, i) => vod(String(i), `Movie ${i}`));
    const { view } = await openWith({ vod: many });
    view.setQuery('movie');
    expect(container.querySelectorAll('.catalog-tile[data-stream-id]').length).toBe(cap);
  });

  it('plays a channel result on select via its playlist index', async () => {
    playlistMock.search.mockReturnValue([chan('Channel One')]);
    playlistMock.indexOf.mockReturnValue(7);
    const { view, handlers } = await openWith();
    view.setQuery('one');
    const tile = container.querySelector('.catalog-tile[data-channel-index="7"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(7);
  });

  it('routes a movie result to onOpenMovie and a series result to onOpenSeries', async () => {
    const { view, handlers } = await openWith({ vod: [vod('10', 'Movie One')], series: [ser('s1', 'Series One')] });
    view.setQuery('one');
    const movie = container.querySelector('.catalog-tile[data-stream-id="10"]') as HTMLElement;
    movie.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onOpenMovie).toHaveBeenCalledWith(account, expect.objectContaining({ streamId: '10' }));

    const series = container.querySelector('.catalog-tile[data-series-id="s1"]') as HTMLElement;
    series.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onOpenSeries).toHaveBeenCalledWith(account, expect.objectContaining({ seriesId: 's1' }));
  });

  it('opens an Xtream movie result on a pointer click', async () => {
    const { view, handlers } = await openWith({ vod: [vod('10', 'Movie One')] });
    view.setQuery('one');
    const movie = container.querySelector('.catalog-tile[data-stream-id="10"]') as HTMLElement;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => movie;
    container.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 50, bubbles: true }));
    document.elementFromPoint = orig;
    expect(handlers.onOpenMovie).toHaveBeenCalledWith(account, expect.objectContaining({ streamId: '10' }));
  });

  it('shows a no-results message when nothing matches', async () => {
    const { view } = await openWith();
    view.setQuery('zzz');
    expect(container.textContent).toContain('No results');
  });

  it('focusFirstResult moves focus into the first result (tab bar handoff)', async () => {
    playlistMock.search.mockReturnValue([chan('Channel One')]);
    const { view } = await openWith();
    view.setQuery('one');
    view.focusFirstResult();
    expect(container.querySelector('.catalog-tile.focused')).not.toBeNull();
  });

  it('reveals the tab bar when Up cannot move within the view', async () => {
    const { view, handlers } = await openWith();
    view.handleAction('up');
    expect(handlers.onRevealTabBar).toHaveBeenCalled();
  });

  it('goes back to Live from Search', async () => {
    const { view, handlers } = await openWith();
    view.handleAction('back');
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it('a superseded a1 load cannot clobber a2 catalog (account-switch race)', async () => {
    const a1: PlaylistEntry = { id: 'a1', name: 'A1', url: 'http://host/a', source: 'xtream', xtream: { username: 'u1', password: 'p1' } };
    const a2: PlaylistEntry = { id: 'a2', name: 'A2', url: 'http://host/a', source: 'xtream', xtream: { username: 'u2', password: 'p2' } };

    let resolveA1Vod!: (v: unknown) => void;
    let resolveA2Vod!: (v: unknown) => void;
    let resolveA1Series!: (v: unknown) => void;
    let resolveA2Series!: (v: unknown) => void;

    catalogMock.loadAllVodStreams
      .mockReturnValueOnce(new Promise((r) => { resolveA1Vod = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveA2Vod = r; }));
    catalogMock.loadAllSeries
      .mockReturnValueOnce(new Promise((r) => { resolveA1Series = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveA2Series = r; }));

    const view = new Search(container, mkHandlers());

    // Start both opens concurrently; neither load has resolved yet.
    const p1 = view.open(a1);
    const p2 = view.open(a2);

    // Resolve a2's load first — it should commit as the current account.
    resolveA2Vod([vod('v2', 'Bravo Movie')]);
    resolveA2Series([]);
    await p2;

    // Resolve a1's stale load last — the guard should discard it.
    resolveA1Vod([vod('v1', 'Alpha Movie')]);
    resolveA1Series([]);
    await p1;

    view.setQuery('movie');
    expect(container.textContent).toContain('Bravo Movie');
    expect(container.textContent).not.toContain('Alpha Movie');
  });
});

describe('Search (M3U-only, no account)', () => {
  async function openM3U() {
    const handlers = mkHandlers();
    const view = new Search(container, handlers);
    await view.open(null);
    return { view, handlers };
  }

  it('does not load a catalog for an M3U-only account', async () => {
    await openM3U();
    expect(catalogMock.loadAllVodStreams).not.toHaveBeenCalled();
    expect(catalogMock.loadAllSeries).not.toHaveBeenCalled();
  });

  it('renders channel results as a vertical list (no poster rails)', async () => {
    playlistMock.search.mockReturnValue([chan('Alpha News'), chan('Beta News')]);
    playlistMock.indexOf.mockImplementation((ch: { name: string }) => (ch.name === 'Alpha News' ? 0 : 1));
    const { view } = await openM3U();
    view.setQuery('news');
    expect(container.querySelectorAll('.search-channel-row').length).toBe(2);
    expect(container.querySelector('.catalog-rail')).toBeNull();
  });

  it('plays a channel row on select', async () => {
    playlistMock.search.mockReturnValue([chan('Alpha News')]);
    playlistMock.indexOf.mockReturnValue(3);
    const { view, handlers } = await openM3U();
    view.setQuery('news');
    const row = container.querySelector('.search-channel-row') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(3);
  });

  it('plays a channel row on a pointer click', async () => {
    playlistMock.search.mockReturnValue([chan('Alpha News')]);
    playlistMock.indexOf.mockReturnValue(5);
    const { handlers, view } = await openM3U();
    view.setQuery('news');
    const row = container.querySelector('.search-channel-row') as HTMLElement;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => row;
    container.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 50, bubbles: true }));
    document.elementFromPoint = orig;
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(5);
  });
});
