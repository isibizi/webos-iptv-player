import type { Action } from '../types';
import { $, $$, html, raw } from '../utils/dom';
import { SpatialNav } from '../navigation/spatial-nav';
import { StorageService } from '../services/storage-service';
import { CONFIG } from '../config';
import { showToast } from './toast';

export class Settings {
  private container: HTMLElement;
  private onSave: (reload: boolean) => void;
  private nav: SpatialNav;

  constructor(container: HTMLElement, onSave: (reload: boolean) => void) {
    this.container = container;
    this.onSave = onSave;
    this.nav = new SpatialNav(container);

    // Mouse/pointer support: clicking a focusable element behaves like remote OK.
    // Attached once on the persistent container (render() replaces innerHTML).
    this.container.addEventListener('click', (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-focusable]');
      if (!el) return;
      this.nav.focus(el);
      this.activate(el);
    });
  }

  render(): void {
    const playlists = StorageService.getPlaylists();
    const epgUrl = StorageService.getEpgUrl();
    const autoPlay = StorageService.getAutoPlay();

    this.container.innerHTML = String(html`
      <div class="settings-view">
        <h2 class="settings-title">Settings</h2>

        <div class="settings-section">
          <h3>Playlists</h3>
          <div class="playlist-entries" id="playlist-entries">
            ${playlists.length
              ? playlists.map((pl, i) => html`
                <div class="settings-row">
                  <div class="settings-field">
                    <label>Name</label>
                    <input type="text" class="settings-input playlist-name"
                           data-focusable data-index="${i}" value="${pl.name || ''}">
                  </div>
                  <div class="settings-field">
                    <label>URL</label>
                    <input type="text" class="settings-input playlist-url"
                           data-focusable data-index="${i}" value="${pl.url || ''}">
                  </div>
                  <button class="btn btn-danger remove-playlist" data-focusable data-index="${i}">Remove</button>
                </div>
              `)
              : raw('<div class="empty-hint">No playlists added yet</div>')}
          </div>
          <button class="btn btn-primary" data-focusable id="add-playlist">+ Add Playlist</button>
        </div>

        <div class="settings-section">
          <h3>EPG (Electronic Program Guide)</h3>
          <div class="settings-row">
            <div class="settings-field wide">
              <label>XMLTV URL</label>
              <input type="text" class="settings-input" data-focusable id="epg-url"
                     value="${epgUrl}" placeholder="https://example.com/epg.xml">
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Playback</h3>
          <div class="settings-row">
            <div class="settings-field">
              <label>Auto-play last channel on startup</label>
              <button class="btn toggle-btn ${autoPlay ? 'active' : ''}"
                      data-focusable id="auto-play-toggle">
                ${autoPlay ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Data Management</h3>
          <div class="settings-row">
            <button class="btn btn-secondary" data-focusable id="refresh-data">Refresh All Data</button>
            <button class="btn btn-danger" data-focusable id="clear-cache">Clear Cache</button>
          </div>
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary btn-large" data-focusable id="save-settings">Save &amp; Apply</button>
          <button class="btn btn-secondary btn-large" data-focusable id="cancel-settings">Cancel</button>
        </div>

        <div class="settings-about">
          ${CONFIG.APP_NAME} v${CONFIG.VERSION}
        </div>
      </div>
    `);

    this.nav = new SpatialNav(this.container);
    this.nav.focusFirst();

    // Enter on input: commit and move to next focusable element in DOM order
    this.container.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
        e.preventDefault();
        (e.target as HTMLInputElement).blur();
        const all = Array.from(this.container.querySelectorAll<HTMLElement>('[data-focusable]'));
        const idx = all.indexOf(e.target as HTMLElement);
        const next = all[idx + 1];
        if (next) this.nav.focus(next);
      }
    });
  }

  handleAction(action: Action): void {
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.nav.move(action);
        break;

      case 'select': {
        const focused = this.nav.focused;
        if (!focused) break;
        this.activate(focused);
        break;
      }
    }
  }

  private activate(el: HTMLElement): void {
    if (el.id === 'add-playlist') {
      this.addPlaylistEntry();
    } else if (el.classList.contains('remove-playlist')) {
      this.removePlaylistEntry(parseInt(el.dataset.index!, 10));
    } else if (el.id === 'auto-play-toggle') {
      el.classList.toggle('active');
      el.textContent = el.classList.contains('active') ? 'ON' : 'OFF';
    } else if (el.id === 'save-settings') {
      this.save();
    } else if (el.id === 'cancel-settings') {
      this.onSave(false);
    } else if (el.id === 'refresh-data') {
      this.onSave(true);
    } else if (el.id === 'clear-cache') {
      StorageService.remove('cached_playlist');
      StorageService.remove('cached_epg');
      showToast('Cache cleared');
    } else if (el.tagName === 'INPUT') {
      (el as HTMLInputElement).focus();
    }
  }

  private addPlaylistEntry(): void {
    const entries = $('#playlist-entries', this.container);
    if (!entries) return;

    const idx = entries.querySelectorAll('.settings-row').length;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <div class="settings-field">
        <label>Name</label>
        <input type="text" class="settings-input playlist-name"
               data-focusable data-index="${idx}" value="" placeholder="My Playlist">
      </div>
      <div class="settings-field">
        <label>URL</label>
        <input type="text" class="settings-input playlist-url"
               data-focusable data-index="${idx}" value="" placeholder="https://...m3u">
      </div>
      <button class="btn btn-danger remove-playlist" data-focusable data-index="${idx}">Remove</button>
    `;

    const emptyHint = entries.querySelector('.empty-hint');
    if (emptyHint) emptyHint.remove();
    entries.appendChild(row);

    this.nav = new SpatialNav(this.container);
    const newInput = row.querySelector<HTMLElement>('input');
    if (newInput) {
      this.nav.focus(newInput);
      (newInput as HTMLInputElement).focus();
    }
  }

  private removePlaylistEntry(index: number): void {
    const entries = $('#playlist-entries', this.container);
    if (!entries) return;
    const rows = entries.querySelectorAll('.settings-row');
    if (rows[index]) rows[index].remove();
    this.nav = new SpatialNav(this.container);
    this.nav.focusFirst();
  }

  private save(): void {
    const names = $$('.playlist-name', this.container) as HTMLInputElement[];
    const urls = $$('.playlist-url', this.container) as HTMLInputElement[];
    const playlists: { name: string; url: string }[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].value.trim();
      if (url) {
        playlists.push({
          name: names[i]?.value.trim() || `Playlist ${i + 1}`,
          url,
        });
      }
    }

    StorageService.setPlaylists(playlists);

    const epgInput = $('#epg-url', this.container) as HTMLInputElement | null;
    if (epgInput) StorageService.setEpgUrl(epgInput.value.trim());

    const autoPlayBtn = $('#auto-play-toggle', this.container);
    if (autoPlayBtn) StorageService.setAutoPlay(autoPlayBtn.classList.contains('active'));

    this.onSave(true);
  }
}
