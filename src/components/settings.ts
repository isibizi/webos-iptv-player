import type { Action, PlaylistEntry, TzMode } from '../types';
import { $, $$, html, raw } from '../utils/dom';
import { morph } from '../utils/morph';
import { SpatialNav } from '../navigation/spatial-nav';
import { StorageService } from '../services/storage-service';
import { clearCachedEpg } from '../services/idb-cache';
import { UploadClient, uploadIdFromUrl } from '../services/upload-client';
import { genPlaylistId } from '../utils/playlist-id';
import { CONFIG } from '../config';
import { showToast } from './toast';
import qrcode from 'qrcode-generator';

/** Generate a PNG data URL containing a QR code for the given text. */
function qrDataUrl(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 4);
}

/** "UTC+08:00" / "UTC-05:00" / "UTC" for a feed offset in minutes. */
function formatOffset(min: number): string {
  if (!min) return 'UTC';
  const sign = min > 0 ? '+' : '-';
  const abs = Math.abs(min);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** "MyList — 12 channels" when count is known, otherwise just the name. */
function uploadLabel(pl: PlaylistEntry): string {
  if (typeof pl.count === 'number') {
    return `${pl.name} — ${pl.count} channel${pl.count === 1 ? '' : 's'}`;
  }
  return pl.name;
}

/** A single-select toggle group: connected buttons, the active one filled.
 *  Shared by every toggle row (styled via .toggle-group in settings.css). */
function toggleGroup(id: string, options: { value: string; label: string }[], active: string) {
  return html`
    <div class="toggle-group" id="${id}">
      ${options.map(o => html`
        <button class="toggle-option ${o.value === active ? 'active' : ''}"
                data-focusable data-value="${o.value}">${o.label}</button>
      `)}
    </div>`;
}

/** What the app does after Settings closes: reload = re-fetch playlist/EPG;
 *  apply = re-render for display-only changes; cancel = discard. */
export type SaveAction = 'reload' | 'apply' | 'cancel';

export class Settings {
  private container: HTMLElement;
  private onSave: (action: SaveAction) => void;
  private nav: SpatialNav;

  constructor(container: HTMLElement, onSave: (action: SaveAction) => void) {
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

    // Enter on input: commit and move to next focusable element in DOM order.
    // Attached once on the persistent container (render() replaces innerHTML).
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

  render(): void {
    const allPlaylists = StorageService.getPlaylists();
    const playlists = allPlaylists.filter(pl => pl.source !== 'upload');
    const uploads = allPlaylists.filter(pl => pl.source === 'upload');
    const epgUrl = StorageService.getEpgUrl();
    const autoPlay = StorageService.getAutoPlay();
    const feedTime = StorageService.getTzMode() === 'feed';
    const tzOffset = StorageService.getEpgTzOffset();

    this.container.innerHTML = String(html`
      <div class="settings-view">
        <h2 class="settings-title">Settings</h2>

        <div class="settings-section">
          <h3>Playlists</h3>
          <div class="playlist-entries" id="playlist-entries">
            ${playlists.length
              ? html`
                <div class="settings-row playlist-header-row">
                  <div class="settings-field"><label>Name</label></div>
                  <div class="settings-field"><label>URL</label></div>
                  <div class="playlist-header-spacer"></div>
                </div>
                ${playlists.map((pl) => html`
                <div class="settings-row" data-id="${pl.id}">
                  <div class="settings-field">
                    <input type="text" class="settings-input playlist-name"
                           aria-label="Playlist name" placeholder="My Playlist"
                           data-focusable value="${pl.name || ''}">
                  </div>
                  <div class="settings-field">
                    <input type="text" class="settings-input playlist-url"
                           aria-label="Playlist URL" placeholder="https://...m3u"
                           data-focusable value="${pl.url || ''}">
                  </div>
                  <button class="btn btn-danger remove-playlist" data-focusable>Remove</button>
                </div>
              `)}`
              : raw('<div class="empty-hint">No playlists added yet</div>')}
          </div>
          <button class="btn btn-primary" data-focusable id="add-playlist">+ Add Playlist</button>
        </div>

        <div class="settings-section">
          <h3>Upload Playlist</h3>
          <div class="upload-section">
            <div class="upload-box upload-box-info" id="upload-info">Checking upload service...</div>
            <div class="upload-box upload-box-list">
              <div class="upload-entries" id="upload-entries">
                ${uploads.length
                  ? uploads.map((pl) => html`
                    <div class="settings-row" data-key="${pl.url}">
                      <div class="settings-field wide">
                        <label>${uploadLabel(pl)}</label>
                      </div>
                      <button class="btn btn-danger remove-upload" data-focusable
                              data-url="${pl.url}">Remove</button>
                    </div>
                  `)
                  : raw('<div class="empty-hint">No uploaded playlists</div>')}
              </div>
            </div>
          </div>
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
          <h3>Display</h3>
          <div class="settings-row settings-toggle-row">
            <label>Programme time zone</label>
            ${toggleGroup('tz-mode', [{ value: 'device', label: 'Device' }, { value: 'feed', label: 'Feed' }], feedTime ? 'feed' : 'device')}
          </div>
          <div class="empty-hint">
            ${tzOffset === null
              ? 'Device uses your device’s time zone. Feed uses the EPG feed’s time zone (load EPG to detect it).'
              : `Device uses your device’s time zone. Feed uses the EPG feed’s time zone (${formatOffset(tzOffset)}).`}
          </div>
        </div>

        <div class="settings-section">
          <h3>Playback</h3>
          <div class="settings-row settings-toggle-row">
            <label>Auto-play last channel on startup</label>
            ${toggleGroup('auto-play', [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }], autoPlay ? 'on' : 'off')}
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

    this.nav.focusFirst();
    void this.loadUploadInfo();
    // Sync uploads from the local service on every Settings open. Subsequent
    // updates arrive via the Luna `uploadEvents` push channel (wired in
    // app.ts → subscribeToUploadEvents) and call refreshUploads() directly.
    void this.refreshUploads();
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
      this.removePlaylistEntry(el);
    } else if (el.classList.contains('remove-upload')) {
      void this.removeUpload(el.dataset.url!);
    } else if (el.classList.contains('toggle-option')) {
      // Single-select toggle group: clear the siblings, activate the chosen option.
      el.parentElement?.querySelectorAll('.toggle-option').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
    } else if (el.id === 'save-settings') {
      this.save();
    } else if (el.id === 'cancel-settings') {
      this.onSave('cancel');
    } else if (el.id === 'refresh-data') {
      this.onSave('reload');
    } else if (el.id === 'clear-cache') {
      StorageService.remove('cached_playlist');
      void clearCachedEpg();
      showToast('Cache cleared');
    } else if (el.tagName === 'INPUT') {
      (el as HTMLInputElement).focus();
    }
  }

  private addPlaylistEntry(): void {
    const entries = $('#playlist-entries', this.container);
    if (!entries) return;

    // First add: replace the empty-hint with the column header row.
    const emptyHint = entries.querySelector('.empty-hint');
    if (emptyHint) {
      emptyHint.remove();
      const header = document.createElement('div');
      header.className = 'settings-row playlist-header-row';
      header.innerHTML = `
        <div class="settings-field"><label>Name</label></div>
        <div class="settings-field"><label>URL</label></div>
        <div class="playlist-header-spacer"></div>
      `;
      entries.appendChild(header);
    }

    // Seed a concrete default name so it persists as a real value (a blank name
    // makes save() fall back to position-based numbering). Use one past the
    // highest existing "Playlist N" (and the row count) so adding after deleting
    // a middle row never reuses a surviving label.
    const nameInputs = entries.querySelectorAll<HTMLInputElement>('.playlist-name');
    const nextNum = Array.from(nameInputs).reduce((max, inp) => {
      const m = /^Playlist (\d+)$/.exec(inp.value.trim());
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, nameInputs.length) + 1;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.dataset.id = genPlaylistId();
    row.innerHTML = `
      <div class="settings-field">
        <input type="text" class="settings-input playlist-name"
               aria-label="Playlist name" placeholder="My Playlist"
               data-focusable value="Playlist ${nextNum}">
      </div>
      <div class="settings-field">
        <input type="text" class="settings-input playlist-url"
               aria-label="Playlist URL" placeholder="https://...m3u"
               data-focusable value="">
      </div>
      <button class="btn btn-danger remove-playlist" data-focusable>Remove</button>
    `;
    entries.appendChild(row);

    const newInput = row.querySelector<HTMLElement>('input');
    if (newInput) {
      this.nav.focus(newInput);
      (newInput as HTMLInputElement).focus();
    }
  }

  private removePlaylistEntry(removeBtn: HTMLElement): void {
    const entries = $('#playlist-entries', this.container);
    if (!entries) return;
    // Remove the row the clicked button sits in — no positional index, so it
    // can't be thrown off by stale/duplicate row ordering.
    removeBtn.closest('.settings-row')?.remove();
    // Drop the header row too if no data rows remain (lone header would look orphaned).
    if (entries.querySelectorAll('.settings-row:not(.playlist-header-row)').length === 0) {
      const header = entries.querySelector('.playlist-header-row');
      if (header) header.remove();
      const e = document.createElement('div');
      e.className = 'empty-hint';
      e.textContent = 'No playlists added yet';
      entries.appendChild(e);
    }
    this.nav.focusFirst();
  }

  private save(): void {
    // Read row-by-row so each row's stable id (data-id) is preserved; a row
    // added before this build has none, so mint one.
    const rows = $$('#playlist-entries .settings-row:not(.playlist-header-row)', this.container) as HTMLElement[];
    const playlists: PlaylistEntry[] = [];

    for (const row of rows) {
      const url = row.querySelector<HTMLInputElement>('.playlist-url')!.value.trim();
      if (!url) continue;
      const name = row.querySelector<HTMLInputElement>('.playlist-name')!.value.trim();
      playlists.push({
        id: row.dataset.id || genPlaylistId(),
        name: name || `Playlist ${playlists.length + 1}`,
        url,
        source: 'url',
      });
    }

    // Preserve auto-managed uploaded playlists (not shown in the URL editor).
    const stored = StorageService.getPlaylists();
    const prevUrls = stored.filter(pl => pl.source !== 'upload');
    const uploads = stored.filter(pl => pl.source === 'upload');
    StorageService.setPlaylists([...playlists, ...uploads]);

    const epgInput = $('#epg-url', this.container) as HTMLInputElement | null;
    const prevEpg = StorageService.getEpgUrl();
    const epgUrl = epgInput ? epgInput.value.trim() : prevEpg;
    if (epgInput) StorageService.setEpgUrl(epgUrl);

    const autoPlayBtn = $('#auto-play .toggle-option.active', this.container);
    if (autoPlayBtn) StorageService.setAutoPlay(autoPlayBtn.dataset.value === 'on');

    const tzModeBtn = $('#tz-mode .toggle-option.active', this.container);
    if (tzModeBtn?.dataset.value) StorageService.setTzMode(tzModeBtn.dataset.value as TzMode);

    // Only a playlist or EPG-URL change needs a re-fetch; display-only settings
    // (time zone, auto-play) just re-render in place.
    const sig = (l: PlaylistEntry[]) => JSON.stringify(l.map(pl => [pl.id, pl.name, pl.url]));
    const dataChanged = epgUrl !== prevEpg || sig(prevUrls) !== sig(playlists);
    this.onSave(dataChanged ? 'reload' : 'apply');
  }

  /**
   * Replace the placeholder text in #upload-info with QR + instructions (or
   * an error when the service is unreachable). Built through `html` so the
   * upload URL — which originates off-device — is escaped, then handed to
   * `morph()` so the surrounding rendered content stays unaffected and we
   * never touch innerHTML directly with an interpolated string.
   */
  private async loadUploadInfo(): Promise<void> {
    const el = $('#upload-info', this.container);
    if (!el) return;
    const info = await UploadClient.getInfo();
    // Re-resolve in case the user navigated away or settings re-rendered.
    const target = $('#upload-info', this.container);
    if (!target) return;
    if (info) {
      const url = info.uploadUrl;
      morph(target, html`
        <img class="upload-qr" alt="QR code linking to ${url}" src="${qrDataUrl(url)}">
        <div class="upload-instructions">
          Scan QR code or open <span class="upload-url">${url}</span> to upload m3u files.
        </div>
      `);
    } else {
      morph(target, html`<span>Upload service is not running.</span>`);
    }
  }

  private async removeUpload(url: string): Promise<void> {
    const id = uploadIdFromUrl(url);
    if (id) await UploadClient.remove(id);

    const remaining = StorageService.getPlaylists().filter(pl => pl.url !== url);
    StorageService.setPlaylists(remaining);
    StorageService.remove('cached_playlist');
    showToast('Uploaded playlist removed');

    await this.refreshUploads();
  }

  /**
   * Pull the latest uploads from the local service into storage, then patch
   * just the #upload-entries section via morph() so the rest of the form
   * keeps its focus and unsaved input.
   *
   * Called on render() (covers uploads that arrived before the user opened
   * Settings) and on every Luna `uploadEvents` push from the upload service
   * (covers uploads that arrive while Settings is open — see app.ts).
   *
   * Safe to call when the settings view is hidden: reconcile still updates
   * storage, but the morph is a no-op against the off-screen container so
   * there's no visible side effect.
   */
  async refreshUploads(): Promise<void> {
    await UploadClient.reconcile();
    const target = $('#upload-entries', this.container);
    if (!target) return;

    const uploads = StorageService.getPlaylists().filter(pl => pl.source === 'upload');
    morph(target, uploads.length
      ? html`${uploads.map((pl) => html`
        <div class="settings-row" data-key="${pl.url}">
          <div class="settings-field wide">
            <label>${uploadLabel(pl)}</label>
          </div>
          <button class="btn btn-danger remove-upload" data-focusable
                  data-url="${pl.url}">Remove</button>
        </div>
      `)}`
      : html`<div class="empty-hint">No uploaded playlists</div>`);
  }
}
