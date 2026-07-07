// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlaylistEntry } from '../types';

const { catalogMock, storageMock } = vi.hoisted(() => ({
  catalogMock: { loadVodCategories: vi.fn(), loadVodStreams: vi.fn(), loadVodInfo: vi.fn() },
  storageMock: { getResumeList: vi.fn(() => [] as unknown[]), getResume: vi.fn(() => null) },
}));
vi.mock('../services/xtream-catalog', () => catalogMock);
vi.mock('../services/storage-service', () => ({ StorageService: storageMock }));

import { Movies } from './movies';

const account: PlaylistEntry = {
  id: 'x1', name: 'X', url: 'http://host:8080', source: 'xtream', xtream: { username: 'u', password: 'p' },
};
const vod = (id: string, name: string, categoryId = '1') => ({
  accountId: 'x1', streamId: id, name, poster: '', rating: '', categoryId, containerExtension: 'mp4',
});

let container: HTMLElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  // clearAllMocks clears calls but not implementations; re-establish the default
  // return so a prior test's mockReturnValue override doesn't leak (order-safety).
  storageMock.getResumeList.mockReturnValue([]);
  storageMock.getResume.mockReturnValue(null);
  container = document.createElement('div');
  document.body.appendChild(container);
});

async function openWith(cats = [{ id: '1', name: 'Cat A' }], streams = [vod('10', 'Movie One')]) {
  catalogMock.loadVodCategories.mockResolvedValue(cats);
  catalogMock.loadVodStreams.mockResolvedValue(streams);
  const handlers = { onRevealTabBar: vi.fn(), onBack: vi.fn(), onPlayVod: vi.fn() };
  const view = new Movies(container, handlers);
  await view.open(account);
  return { view, handlers };
}

describe('Movies browse + grid', () => {
  it('renders a rail per preloaded category with poster tiles', async () => {
    await openWith([{ id: '1', name: 'Cat A' }], [vod('10', 'Movie One')]);
    expect(container.querySelector('.catalog-rail-title')?.textContent).toContain('Cat A');
    expect(container.querySelector('.catalog-tile[data-item-id="10"]')?.textContent).toContain('Movie One');
  });

  it('updates the hero title and backdrop to the focused movie', async () => {
    const m1 = { accountId: 'x1', streamId: '10', name: 'Movie One', poster: 'http://host/p1.jpg', rating: '', categoryId: '1', containerExtension: 'mp4' };
    const m2 = { accountId: 'x1', streamId: '11', name: 'Movie Two', poster: 'http://host/p2.jpg', rating: '', categoryId: '1', containerExtension: 'mp4' };
    await openWith([{ id: '1', name: 'Cat A' }], [m1, m2]);
    const hero = container.querySelector<HTMLElement>('.catalog-hero')!;
    const title = () => container.querySelector('.catalog-hero-title')?.textContent;

    container.querySelector('.catalog-tile[data-item-id="11"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    expect(title()).toBe('Movie Two');
    expect(hero.style.backgroundImage).toContain('p2.jpg');

    container.querySelector('.catalog-tile[data-item-id="10"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    expect(title()).toBe('Movie One');
    expect(hero.style.backgroundImage).toContain('p1.jpg');
  });

  it('shows a Continue rail from the resume list', async () => {
    const { StorageService } = await import('../services/storage-service');
    (StorageService.getResumeList as ReturnType<typeof vi.fn>).mockReturnValue([
      { accountId: 'x1', kind: 'vod', itemId: '10', name: 'Movie One', poster: '', ext: 'mp4', position: 100, duration: 6000, updatedAt: 1 },
    ]);
    await openWith();
    expect(container.textContent).toContain('Continue Watching');
  });

  it('reveals the tab bar when Up cannot move within the view', async () => {
    const { view, handlers } = await openWith();
    view.handleAction('up');
    expect(handlers.onRevealTabBar).toHaveBeenCalled();
  });

  it('drills into a non-rail category grid and back to browse', async () => {
    // 7 categories: the first RAIL_CATEGORIES (6) become poster rails; the 7th
    // is a non-rail tile in the "All Categories" rail — the drill-in target.
    const cats = Array.from({ length: 7 }, (_, i) => ({ id: String(i + 1), name: `Cat ${i + 1}` }));
    const { view, handlers } = await openWith(cats, [vod('10', 'Movie One')]);
    const cat = container.querySelector('.catalog-cat[data-category-id="7"]') as HTMLElement;
    expect(cat).not.toBeNull();
    cat.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    catalogMock.loadVodStreams.mockResolvedValue([vod('20', 'Movie Two', '7')]);
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    expect(container.querySelector('.catalog-grid')).not.toBeNull();
    expect(container.querySelector('.catalog-tile[data-item-id="20"]')).not.toBeNull();
    view.handleAction('back');
    expect(container.querySelector('.catalog-browse')).not.toBeNull();
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('goes back to Live from the browse top level', async () => {
    const { view, handlers } = await openWith();
    view.handleAction('back');
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it('refreshes the Continue rail from storage on each browse render', async () => {
    const { StorageService } = await import('../services/storage-service');
    const getResumeList = StorageService.getResumeList as ReturnType<typeof vi.fn>;
    getResumeList.mockReturnValue([]);
    catalogMock.loadVodInfo.mockResolvedValue({
      plot: '', cast: '', director: '', genre: '', releaseDate: '', durationSecs: 0, poster: '',
    });
    const { view } = await openWith();
    expect(container.textContent).not.toContain('Continue Watching');

    // A movie is watched, so a resume entry now exists; walking detail -> browse
    // should surface it without re-entering the section.
    getResumeList.mockReturnValue([
      { accountId: 'x1', kind: 'vod', itemId: '10', name: 'Movie One', poster: '', ext: 'mp4', position: 100, duration: 6000, updatedAt: 1 },
    ]);
    const tile = container.querySelector('.catalog-tile[data-item-id="10"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    view.handleAction('back'); // detail -> browse re-render
    expect(container.textContent).toContain('Continue Watching');
  });
});

describe('Movies detail', () => {
  it('renders plot/meta and a Play button, and plays from the start', async () => {
    catalogMock.loadVodInfo.mockResolvedValue({
      plot: 'A plot.', cast: 'Actor A', director: 'Dir A', genre: 'Drama',
      releaseDate: '2020-05-01', durationSecs: 3600, poster: 'http://host:8080/p.jpg',
    });
    const { view, handlers } = await openWith([{ id: '1', name: 'Cat A' }], [vod('10', 'Movie One')]);
    const tile = container.querySelector('.catalog-tile[data-item-id="10"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();

    expect(container.querySelector('.detail-plot')?.textContent).toContain('A plot.');
    expect(container.textContent).toContain('Drama');
    expect(container.textContent).toContain('2020');

    const play = container.querySelector('[data-action="play"]') as HTMLElement;
    play.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({
      itemId: '10', accountId: 'x1', kind: 'vod', resumeSecs: 0,
      url: 'http://host:8080/movie/u/p/10.mp4',
    }));
  });

  it('offers Resume when a resume point exists and passes its position', async () => {
    const { StorageService } = await import('../services/storage-service');
    (StorageService.getResume as ReturnType<typeof vi.fn>).mockReturnValue(
      { accountId: 'x1', kind: 'vod', itemId: '10', name: 'Movie One', poster: '', position: 900, duration: 3600, updatedAt: 1 },
    );
    catalogMock.loadVodInfo.mockResolvedValue({
      plot: '', cast: '', director: '', genre: '', releaseDate: '', durationSecs: 3600, poster: '',
    });
    const { view, handlers } = await openWith([{ id: '1', name: 'Cat A' }], [vod('10', 'Movie One')]);
    const tile = container.querySelector('.catalog-tile[data-item-id="10"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();

    const resume = container.querySelector('[data-action="resume"]') as HTMLElement;
    expect(resume).not.toBeNull();
    resume.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ resumeSecs: 900 }));
  });

  it('backs out of detail to the browse view', async () => {
    catalogMock.loadVodInfo.mockResolvedValue({ plot: '', cast: '', director: '', genre: '', releaseDate: '', durationSecs: 0, poster: '' });
    const { view, handlers } = await openWith();
    const tile = container.querySelector('.catalog-tile[data-item-id="10"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    view.handleAction('back');
    expect(container.querySelector('.catalog-browse')).not.toBeNull();
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('preserves detail focus across the info re-render instead of snapping to the first button', async () => {
    const { StorageService } = await import('../services/storage-service');
    (StorageService.getResume as ReturnType<typeof vi.fn>).mockReturnValue(
      { accountId: 'x1', kind: 'vod', itemId: '10', name: 'Movie One', poster: '', position: 900, duration: 3600, updatedAt: 1 },
    );
    let resolveInfo!: (v: unknown) => void;
    catalogMock.loadVodInfo.mockReturnValue(new Promise((r) => { resolveInfo = r; }));
    const { view } = await openWith([{ id: '1', name: 'Cat A' }], [vod('10', 'Movie One')]);
    const tile = container.querySelector('.catalog-tile[data-item-id="10"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); // info-less render committed; focus lands on the first button (Resume)
    const play = container.querySelector('[data-action="play"]') as HTMLElement;
    play.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })); // move focus to Play
    expect(container.querySelector('.focused')?.getAttribute('data-key')).toBe('play');
    resolveInfo({ plot: 'x', cast: '', director: '', genre: '', releaseDate: '', durationSecs: 0, poster: '' });
    await Promise.resolve(); await Promise.resolve(); // info re-render
    expect(container.querySelector('.focused')?.getAttribute('data-key')).toBe('play');
  });
});

describe('Movies deep-link (openItem)', () => {
  it('opens a movie detail directly and Back returns to Search via the callback', async () => {
    catalogMock.loadVodInfo.mockResolvedValue({ plot: 'Deep plot.', cast: '', director: '', genre: '', releaseDate: '', durationSecs: 0, poster: '' });
    const handlers = { onRevealTabBar: vi.fn(), onBack: vi.fn(), onPlayVod: vi.fn() };
    const onDetailBack = vi.fn();
    const view = new Movies(container, handlers);
    await view.openItem(account, vod('42', 'Deep Movie', '9'), onDetailBack);
    expect(container.querySelector('.movies-detail')).not.toBeNull();
    expect(container.textContent).toContain('Deep Movie');
    // No browse is loaded underneath; Back returns to Search via the callback.
    expect(container.querySelector('.catalog-browse')).toBeNull();
    view.handleAction('back');
    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(handlers.onBack).not.toHaveBeenCalled(); // did not fall through to Live
  });
});
