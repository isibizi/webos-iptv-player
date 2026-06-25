// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TzMode } from '../types';

const { state, storageMock, toastMock, uploadMock } = vi.hoisted(() => {
  const state = {
    playlists: [] as { name: string; url: string; source?: 'upload' | 'url' }[],
    epg: '',
    autoPlay: false,
    tzMode: 'device' as TzMode,
    tzOffset: null as number | null,
  };
  return {
    state,
    storageMock: {
      getPlaylists: vi.fn(() => state.playlists),
      getEpgUrl: vi.fn(() => state.epg),
      getAutoPlay: vi.fn(() => state.autoPlay),
      getTzMode: vi.fn(() => state.tzMode),
      getEpgTzOffset: vi.fn(() => state.tzOffset),
      setPlaylists: vi.fn(),
      setEpgUrl: vi.fn(),
      setAutoPlay: vi.fn(),
      setTzMode: vi.fn(),
      remove: vi.fn(),
    },
    toastMock: { showToast: vi.fn() },
    uploadMock: {
      // Default to "service unreachable" so render's async loadUploadInfo is a
      // no-op for existing tests. Tests can override via mockResolvedValueOnce.
      getInfo: vi.fn(async () => null),
      list: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      reconcile: vi.fn(async () => undefined),
    },
  };
});

vi.mock('../services/storage-service', () => ({ StorageService: storageMock }));
vi.mock('../services/idb-cache', () => ({ clearCachedEpg: vi.fn(async () => {}) }));
vi.mock('./toast', () => ({ showToast: toastMock.showToast }));
vi.mock('../services/upload-client', () => ({
  UploadClient: uploadMock,
  uploadIdFromUrl: (url: string) => {
    const m = url.match(/\/uploads\/([^/]+?)(?:\.m3u)?$/i);
    return m ? decodeURIComponent(m[1]) : '';
  },
}));

import { Settings } from './settings';
import { clearCachedEpg } from '../services/idb-cache';

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
    expect(container.querySelector('#auto-play .toggle-option.active')!.getAttribute('data-value')).toBe('on');
  });
});

describe('Settings editing', () => {
  beforeEach(() => settings.render());

  it('adds a playlist row and removes the empty hint', () => {
    click('#add-playlist');
    expect(container.querySelectorAll('#playlist-entries .settings-row:not(.playlist-header-row)')).toHaveLength(1);
    expect(container.querySelector('#playlist-entries .empty-hint')).toBeNull();
  });

  it('removes a playlist row', () => {
    state.playlists = [{ name: 'P1', url: 'http://a' }];
    settings.render();
    expect(container.querySelectorAll('#playlist-entries .settings-row:not(.playlist-header-row)')).toHaveLength(1);
    click('.remove-playlist');
    expect(container.querySelectorAll('#playlist-entries .settings-row:not(.playlist-header-row)')).toHaveLength(0);
  });

  it('keeps each survivor\'s name and stable id when a middle row is removed', () => {
    // Reproduces: add 5 with blank names, delete the 3rd, save. The 5th must
    // keep its "Playlist 5" name AND its original id — no positional renumber,
    // no re-id — so its tab/channels stay put.
    const urls = ['http://a', 'http://b', 'http://c', 'http://d', 'http://e'];
    for (let i = 0; i < 5; i++) {
      click('#add-playlist');
      const urlInputs = container.querySelectorAll<HTMLInputElement>('.playlist-url');
      urlInputs[urlInputs.length - 1].value = urls[i];
    }
    const rows = () => Array.from(container.querySelectorAll<HTMLElement>(
      '#playlist-entries .settings-row:not(.playlist-header-row)'));
    const idBefore = rows().map(r => r.dataset.id);
    expect(rows().map(r => r.querySelector<HTMLInputElement>('.playlist-name')!.value))
      .toEqual(['Playlist 1', 'Playlist 2', 'Playlist 3', 'Playlist 4', 'Playlist 5']);

    container.querySelectorAll<HTMLElement>('.remove-playlist')[2]
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    click('#save-settings');

    const saved = storageMock.setPlaylists.mock.calls.at(-1)![0] as { id: string; name: string }[];
    expect(saved.map(p => p.name)).toEqual(['Playlist 1', 'Playlist 2', 'Playlist 4', 'Playlist 5']);
    expect(saved.map(p => p.id)).toEqual([idBefore[0], idBefore[1], idBefore[3], idBefore[4]]);
  });

  it('removes the row whose button was clicked, even after edits churn the row order', () => {
    // Regression: removal used to key off a positional data-index that went
    // stale/duplicate after an add-following-a-remove, so clicking one row's
    // Remove could delete a different row. It now deletes the row the button
    // sits in (closest), independent of ordering.
    const addRow = (name: string) => {
      click('#add-playlist');
      const last = Array.from(container.querySelectorAll<HTMLElement>(
        '#playlist-entries .settings-row:not(.playlist-header-row)')).at(-1)!;
      last.querySelector<HTMLInputElement>('.playlist-name')!.value = name;
      last.querySelector<HTMLInputElement>('.playlist-url')!.value = 'http://' + name;
    };
    const rowNames = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>('.playlist-name')).map(n => n.value);
    const removeByName = (name: string) =>
      Array.from(container.querySelectorAll<HTMLElement>('.settings-row'))
        .find(r => r.querySelector<HTMLInputElement>('.playlist-name')?.value === name)!
        .querySelector<HTMLElement>('.remove-playlist')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    addRow('A'); addRow('B'); addRow('C');
    removeByName('B');   // churn the middle
    addRow('D');         // re-add: under the old scheme D reused C's stale index
    expect(rowNames()).toEqual(['A', 'C', 'D']);

    removeByName('C');   // the old positional logic deleted D here instead
    expect(rowNames()).toEqual(['A', 'D']);
  });

  it("seeds the next-add name past the highest existing 'Playlist N'", () => {
    const urls = ['http://a', 'http://b', 'http://c', 'http://d'];
    for (let i = 0; i < 4; i++) {
      click('#add-playlist');
      container.querySelectorAll<HTMLInputElement>('.playlist-url')[i].value = urls[i];
    }
    container.querySelectorAll<HTMLElement>('.remove-playlist')[2] // remove 'Playlist 3'
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    click('#add-playlist');
    const names = Array.from(container.querySelectorAll<HTMLInputElement>('.playlist-name')).map(n => n.value);
    expect(names).toEqual(['Playlist 1', 'Playlist 2', 'Playlist 4', 'Playlist 5']);
  });

  it('shows Name/URL labels only once as column headers, not on every row', () => {
    state.playlists = [
      { name: 'P1', url: 'http://a' },
      { name: 'P2', url: 'http://b' },
      { name: 'P3', url: 'http://c' },
    ];
    settings.render();
    // Exactly two labels in #playlist-entries: one "Name", one "URL".
    const labels = Array.from(container.querySelectorAll<HTMLLabelElement>('#playlist-entries label'))
      .map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Name', 'URL']);
    // The data rows themselves contain no labels (just inputs + Remove button).
    const dataRows = container.querySelectorAll('#playlist-entries .settings-row:not(.playlist-header-row)');
    for (const row of dataRows) {
      expect(row.querySelectorAll('label')).toHaveLength(0);
    }
  });

  it('removing the last playlist row also removes the column-header row', () => {
    state.playlists = [{ name: 'P1', url: 'http://a' }];
    settings.render();
    expect(container.querySelector('#playlist-entries .playlist-header-row')).not.toBeNull();
    click('.remove-playlist');
    expect(container.querySelector('#playlist-entries .playlist-header-row')).toBeNull();
    expect(container.querySelector('#playlist-entries .empty-hint')?.textContent).toBe('No playlists added yet');
  });

  it('add-playlist on an empty list inserts the header row first', () => {
    expect(container.querySelector('#playlist-entries .playlist-header-row')).toBeNull();
    click('#add-playlist');
    expect(container.querySelector('#playlist-entries .playlist-header-row')).not.toBeNull();
    expect(container.querySelectorAll('#playlist-entries .settings-row:not(.playlist-header-row)')).toHaveLength(1);
  });

  it('selecting On activates auto-play', () => {
    const activeVal = () => container.querySelector('#auto-play .toggle-option.active')!.getAttribute('data-value');
    expect(activeVal()).toBe('off');
    click('#auto-play [data-value="on"]');
    expect(activeVal()).toBe('on');
  });

  it('clears the playlist and EPG caches and shows a toast', () => {
    click('#clear-cache');
    expect(storageMock.remove).toHaveBeenCalledWith('cached_playlist');
    expect(clearCachedEpg).toHaveBeenCalled();
    expect(toastMock.showToast).toHaveBeenCalledWith('Cache cleared');
  });

  it('cancel discards; refresh reloads', () => {
    click('#cancel-settings');
    expect(onSave).toHaveBeenLastCalledWith('cancel');
    click('#refresh-data');
    expect(onSave).toHaveBeenLastCalledWith('reload');
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
    click('#auto-play [data-value="on"]');

    click('#save-settings');

    expect(storageMock.setPlaylists).toHaveBeenCalledWith([{ id: expect.any(String), name: 'My', url: 'http://x', source: 'url' }]);
    expect(storageMock.setEpgUrl).toHaveBeenCalledWith('http://epg');
    expect(storageMock.setAutoPlay).toHaveBeenCalledWith(true);
    expect(onSave).toHaveBeenCalledWith('reload'); // playlist + EPG changed
  });

  it("reloads when a playlist is re-id'd (same name+url, new id)", () => {
    // Delete + re-add of the same name/url gives the row a fresh id; the
    // signature must notice the id changed (else cache keeps the old id).
    state.playlists = [{ id: 'a', name: 'P', url: 'http://p' }];
    settings.render();
    container.querySelector<HTMLElement>(
      '#playlist-entries .settings-row:not(.playlist-header-row)')!.dataset.id = 'b';
    click('#save-settings');
    expect(onSave).toHaveBeenCalledWith('reload');
  });

  it('applies a display-only change without a full reload', () => {
    state.playlists = [{ id: 'p1', name: 'P', url: 'http://p' }]; // unchanged by the form
    settings.render();
    click('#tz-mode [data-value="feed"]'); // only the time zone changes
    click('#save-settings');
    expect(storageMock.setTzMode).toHaveBeenCalledWith('feed');
    expect(onSave).toHaveBeenCalledWith('apply'); // no re-fetch
  });

  it('defaults a missing name to "Playlist N"', () => {
    const urls = container.querySelectorAll<HTMLInputElement>('.playlist-url');
    urls[0].value = 'http://only';
    click('#save-settings');
    expect(storageMock.setPlaylists).toHaveBeenCalledWith([{ id: expect.any(String), name: 'Playlist 1', url: 'http://only', source: 'url' }]);
  });

  it('selecting the Feed option persists the feed mode', () => {
    const activeTz = () => container.querySelector('#tz-mode .toggle-option.active')!.getAttribute('data-value');
    expect(activeTz()).toBe('device'); // default
    click('#tz-mode [data-value="feed"]');
    expect(activeTz()).toBe('feed');
    click('#save-settings');
    expect(storageMock.setTzMode).toHaveBeenCalledWith('feed');
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

describe('Settings uploads section', () => {
  beforeEach(() => {
    state.playlists = [
      { name: 'Manual', url: 'http://manual', source: 'url' },
      { name: 'From Phone', url: 'http://127.0.0.1:8890/uploads/from-phone.m3u', source: 'upload' },
    ];
  });

  it('renders uploaded playlists in the upload section, not the URL editor', () => {
    settings.render();
    expect(container.querySelectorAll('#playlist-entries .settings-row:not(.playlist-header-row)')).toHaveLength(1);
    expect(container.querySelector('#playlist-entries input.playlist-name')!).toHaveProperty('value', 'Manual');
    const uploadRows = container.querySelectorAll('#upload-entries .settings-row');
    expect(uploadRows).toHaveLength(1);
    expect(uploadRows[0].querySelector('label')!.textContent).toBe('From Phone');
    expect(uploadRows[0].querySelector<HTMLElement>('.remove-upload')!.dataset.url)
      .toBe('http://127.0.0.1:8890/uploads/from-phone.m3u');
  });

  it('appends the channel count to the upload label when stored', () => {
    state.playlists = [
      { name: 'My Phone List', url: 'http://127.0.0.1:8890/uploads/p.m3u', source: 'upload', count: 12 },
    ];
    settings.render();
    expect(container.querySelector('#upload-entries label')!.textContent)
      .toBe('My Phone List — 12 channels');
  });

  it('uses singular "channel" when the count is exactly 1', () => {
    state.playlists = [
      { name: 'Solo', url: 'http://127.0.0.1:8890/uploads/solo.m3u', source: 'upload', count: 1 },
    ];
    settings.render();
    expect(container.querySelector('#upload-entries label')!.textContent)
      .toBe('Solo — 1 channel');
  });

  it('falls back to the bare name when no count is available (offline / pre-reconcile storage)', () => {
    state.playlists = [
      { name: 'Anon', url: 'http://127.0.0.1:8890/uploads/anon.m3u', source: 'upload' },
    ];
    settings.render();
    expect(container.querySelector('#upload-entries label')!.textContent).toBe('Anon');
  });

  it('shows the empty-hint when there are no uploaded playlists', () => {
    state.playlists = [];
    settings.render();
    expect(container.querySelector('#upload-entries .empty-hint')?.textContent)
      .toBe('No uploaded playlists');
  });

  it('escapes a malicious upload name (no live element injected)', () => {
    state.playlists = [
      { name: '<img src=x onerror=alert(1)>', url: 'http://127.0.0.1:8890/uploads/x.m3u', source: 'upload' },
    ];
    settings.render();
    expect(container.querySelector('#upload-entries img')).toBeNull();
    expect(container.querySelector('#upload-entries label')!.textContent)
      .toContain('<img src=x onerror=');
  });

  it('removeUpload calls the service, drops the entry from storage, and toasts', async () => {
    settings.render();
    container.querySelector<HTMLElement>('.remove-upload')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // settings.removeUpload is async (awaits UploadClient.remove); flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(uploadMock.remove).toHaveBeenCalledWith('from-phone');
    expect(storageMock.setPlaylists).toHaveBeenCalledWith([
      { name: 'Manual', url: 'http://manual', source: 'url' },
    ]);
    expect(storageMock.remove).toHaveBeenCalledWith('cached_playlist');
    expect(toastMock.showToast).toHaveBeenCalledWith('Uploaded playlist removed');
  });

  it('save() preserves uploaded playlists alongside the edited URL list', () => {
    settings.render();
    const urls = container.querySelectorAll<HTMLInputElement>('.playlist-url');
    urls[0].value = 'http://renamed';
    container.querySelector<HTMLElement>('#save-settings')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(storageMock.setPlaylists).toHaveBeenCalledWith([
      { id: expect.any(String), name: 'Manual', url: 'http://renamed', source: 'url' },
      { name: 'From Phone', url: 'http://127.0.0.1:8890/uploads/from-phone.m3u', source: 'upload' },
    ]);
  });

  it('renders the QR + URL when the upload service is reachable', async () => {
    uploadMock.getInfo.mockResolvedValueOnce({
      ip: '192.168.1.2', port: 8890, uploadUrl: 'http://192.168.1.2:8890/upload',
    });
    settings.render();
    await new Promise((r) => setTimeout(r, 0));
    const info = container.querySelector('#upload-info')!;
    expect(info.querySelector('.upload-url')!.textContent).toBe('http://192.168.1.2:8890/upload');
    const img = info.querySelector<HTMLImageElement>('img.upload-qr');
    expect(img).not.toBeNull();
    expect(img!.src.startsWith('data:image/')).toBe(true);
  });

  it('shows an unavailable message when the upload service is unreachable', async () => {
    // Default mock returns null -> service unreachable.
    settings.render();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#upload-info')!.textContent)
      .toContain('Upload service is not running');
  });
});

describe('Settings uploads auto-refresh', () => {
  // Settings reconciles + morphs the upload list on open. While the view is
  // open, app.ts subscribes to the upload service's Luna `uploadEvents` push
  // channel and calls settings.refreshUploads() on each push (event-driven,
  // no polling).

  beforeEach(() => {
    // Open Settings with no uploads visible.
    state.playlists = [];
  });

  it('reconciles on render so an upload that arrived before opening shows up', async () => {
    // Simulate reconcile pulling in a new upload from the service.
    uploadMock.reconcile.mockImplementationOnce(async () => {
      state.playlists = [
        { name: 'Channel One', url: 'http://127.0.0.1:8890/uploads/channel-one.m3u', source: 'upload' },
      ];
    });

    settings.render();
    // First render reads empty storage → empty hint
    expect(container.querySelector('#upload-entries .empty-hint')).not.toBeNull();

    // Flush refreshUploads (reconcile resolves, then morph applies)
    await Promise.resolve();
    await Promise.resolve();

    expect(uploadMock.reconcile).toHaveBeenCalled();
    const rows = container.querySelectorAll('#upload-entries .settings-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('label')!.textContent).toBe('Channel One');
    expect(container.querySelector('#upload-entries .empty-hint')).toBeNull();
  });

  it('refreshUploads() (the public hook fired by app.ts on each Luna push) reconciles + morphs in place', async () => {
    settings.render();
    await Promise.resolve(); await Promise.resolve();
    uploadMock.reconcile.mockClear();

    // Simulate a push from the upload service: a new file arrived.
    uploadMock.reconcile.mockImplementationOnce(async () => {
      state.playlists = [
        { name: 'Pushed', url: 'http://127.0.0.1:8890/uploads/pushed.m3u', source: 'upload' },
      ];
    });

    await settings.refreshUploads();

    expect(uploadMock.reconcile).toHaveBeenCalledTimes(1);
    const rows = container.querySelectorAll('#upload-entries .settings-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('label')!.textContent).toBe('Pushed');
  });

  it('refreshUploads() can be called when settings has never rendered (event arrives early) without throwing', async () => {
    // No render() yet — #upload-entries doesn't exist in the DOM.
    uploadMock.reconcile.mockImplementationOnce(async () => {
      state.playlists = [
        { name: 'Early', url: 'http://127.0.0.1:8890/uploads/early.m3u', source: 'upload' },
      ];
    });

    await expect(settings.refreshUploads()).resolves.toBeUndefined();
    // Reconcile still runs (storage gets updated), only the morph is skipped.
    expect(uploadMock.reconcile).toHaveBeenCalledTimes(1);
  });

  it('removes the empty-hint and replaces with rows in a single morph (no flicker)', async () => {
    uploadMock.reconcile.mockImplementationOnce(async () => {
      state.playlists = [
        { name: 'A', url: 'http://127.0.0.1:8890/uploads/a.m3u', source: 'upload' },
        { name: 'B', url: 'http://127.0.0.1:8890/uploads/b.m3u', source: 'upload' },
      ];
    });

    settings.render();
    await Promise.resolve(); await Promise.resolve();

    const labels = Array.from(container.querySelectorAll('#upload-entries label'))
      .map((l) => l.textContent);
    expect(labels).toEqual(['A', 'B']);
    // Each row has a stable data-key for morph identity.
    const keys = Array.from(container.querySelectorAll<HTMLElement>('#upload-entries .settings-row'))
      .map((r) => r.getAttribute('data-key'));
    expect(keys).toEqual([
      'http://127.0.0.1:8890/uploads/a.m3u',
      'http://127.0.0.1:8890/uploads/b.m3u',
    ]);
  });
});

describe('Settings listener lifecycle', () => {
  it('binds persistent-container listeners once, not per render', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const spy = vi.spyOn(c, 'addEventListener');
    const s = new Settings(c, vi.fn());
    s.render();
    s.render();
    s.render();
    const count = (type: string) =>
      spy.mock.calls.filter(([t]) => t === type).length;
    expect(count('nav:hover')).toBe(1);
    expect(count('keydown')).toBe(1);
    expect(count('click')).toBe(1);
  });
});
