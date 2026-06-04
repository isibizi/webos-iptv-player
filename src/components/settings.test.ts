// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { state, storageMock, toastMock } = vi.hoisted(() => {
  const state = {
    playlists: [] as { name: string; url: string }[],
    epg: '',
    autoPlay: false,
  };
  return {
    state,
    storageMock: {
      getPlaylists: vi.fn(() => state.playlists),
      getEpgUrl: vi.fn(() => state.epg),
      getAutoPlay: vi.fn(() => state.autoPlay),
      setPlaylists: vi.fn(),
      setEpgUrl: vi.fn(),
      setAutoPlay: vi.fn(),
      remove: vi.fn(),
    },
    toastMock: { showToast: vi.fn() },
  };
});

vi.mock('../services/storage-service', () => ({ StorageService: storageMock }));
vi.mock('./toast', () => ({ showToast: toastMock.showToast }));

import { Settings } from './settings';

let container: HTMLElement;
let onSave: ReturnType<typeof vi.fn>;
let settings: Settings;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  state.playlists = [];
  state.epg = '';
  state.autoPlay = false;
  vi.clearAllMocks();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  onSave = vi.fn();
  settings = new Settings(container, onSave);
});

function click(selector: string): void {
  container.querySelector<HTMLElement>(selector)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('Settings.render', () => {
  it('shows an empty hint when there are no playlists', () => {
    settings.render();
    expect(container.querySelector('.empty-hint')?.textContent).toBe('No playlists added yet');
  });

  it('renders a row per configured playlist with its values', () => {
    state.playlists = [{ name: 'P1', url: 'http://a' }, { name: 'P2', url: 'http://b' }];
    state.epg = 'http://epg';
    settings.render();
    const names = Array.from(container.querySelectorAll<HTMLInputElement>('.playlist-name'));
    const urls = Array.from(container.querySelectorAll<HTMLInputElement>('.playlist-url'));
    expect(names.map(n => n.value)).toEqual(['P1', 'P2']);
    expect(urls.map(u => u.value)).toEqual(['http://a', 'http://b']);
    expect(container.querySelector<HTMLInputElement>('#epg-url')!.value).toBe('http://epg');
  });

  it('reflects the auto-play state on the toggle', () => {
    state.autoPlay = true;
    settings.render();
    const toggle = container.querySelector('#auto-play-toggle')!;
    expect(toggle.classList.contains('active')).toBe(true);
    expect(toggle.textContent?.trim()).toBe('ON');
  });
});

describe('Settings editing', () => {
  beforeEach(() => settings.render());

  it('adds a playlist row and removes the empty hint', () => {
    click('#add-playlist');
    expect(container.querySelectorAll('#playlist-entries .settings-row')).toHaveLength(1);
    expect(container.querySelector('.empty-hint')).toBeNull();
  });

  it('removes a playlist row', () => {
    state.playlists = [{ name: 'P1', url: 'http://a' }];
    settings.render();
    expect(container.querySelectorAll('#playlist-entries .settings-row')).toHaveLength(1);
    click('.remove-playlist');
    expect(container.querySelectorAll('#playlist-entries .settings-row')).toHaveLength(0);
  });

  it('toggles auto-play off to on', () => {
    const toggle = container.querySelector('#auto-play-toggle')!;
    expect(toggle.textContent?.trim()).toBe('OFF');
    click('#auto-play-toggle');
    expect(toggle.classList.contains('active')).toBe(true);
    expect(toggle.textContent?.trim()).toBe('ON');
  });

  it('clears the cache and shows a toast', () => {
    click('#clear-cache');
    expect(storageMock.remove).toHaveBeenCalledWith('cached_playlist');
    expect(storageMock.remove).toHaveBeenCalledWith('cached_epg');
    expect(toastMock.showToast).toHaveBeenCalledWith('Cache cleared');
  });

  it('cancel calls onSave(false); refresh calls onSave(true)', () => {
    click('#cancel-settings');
    expect(onSave).toHaveBeenLastCalledWith(false);
    click('#refresh-data');
    expect(onSave).toHaveBeenLastCalledWith(true);
  });
});

describe('Settings.save', () => {
  beforeEach(() => {
    state.playlists = [{ name: '', url: '' }, { name: '', url: '' }];
    settings.render();
  });

  it('persists trimmed playlists, EPG and auto-play, then reloads', () => {
    const names = container.querySelectorAll<HTMLInputElement>('.playlist-name');
    const urls = container.querySelectorAll<HTMLInputElement>('.playlist-url');
    names[0].value = 'My';
    urls[0].value = '  http://x  ';
    names[1].value = 'Unnamed';
    urls[1].value = '   '; // blank URL -> dropped
    container.querySelector<HTMLInputElement>('#epg-url')!.value = ' http://epg ';
    click('#auto-play-toggle'); // -> ON

    click('#save-settings');

    expect(storageMock.setPlaylists).toHaveBeenCalledWith([{ name: 'My', url: 'http://x' }]);
    expect(storageMock.setEpgUrl).toHaveBeenCalledWith('http://epg');
    expect(storageMock.setAutoPlay).toHaveBeenCalledWith(true);
    expect(onSave).toHaveBeenCalledWith(true);
  });

  it('defaults a missing name to "Playlist N"', () => {
    const urls = container.querySelectorAll<HTMLInputElement>('.playlist-url');
    urls[0].value = 'http://only';
    click('#save-settings');
    expect(storageMock.setPlaylists).toHaveBeenCalledWith([{ name: 'Playlist 1', url: 'http://only' }]);
  });
});

describe('Settings.handleAction', () => {
  it('select activates the focused control (remote OK)', () => {
    state.playlists = [{ name: 'P1', url: 'http://a' }];
    settings.render();
    container.querySelector<HTMLElement>('#save-settings')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    settings.handleAction('select');
    expect(storageMock.setPlaylists).toHaveBeenCalled();
  });
});
