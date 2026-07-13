import type { Action } from '../types';
import type { OnlineSubtitleResult } from '../services/subtitle-search/types';
import { html, raw } from '../utils/dom';
import { morph } from '../utils/morph';
import { languageName } from '../utils/subtitle-tracks';
import { DOWNLOAD_ICON } from './icons';

const PROVIDER_LABEL: Record<string, string> = { opensubtitles: 'OpenSubtitles', subdl: 'SubDL', assrt: 'Assrt' };

// Group digits into thousands (chrome68-safe, no Intl/locale dependency).
function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Terminal status messages (errors / empty) auto-dismiss after this long; the
// transient "Searching…" / "Downloading…" ones are replaced by the next state.
const STATUS_AUTO_HIDE_MS = 3000;

/** Modal list of online subtitle search results shown over the player. Owns its
 *  own focus index and visibility; selection routes back through `onPick`. All
 *  provider/release text is untrusted and rendered through `html` (escaped). */
export class SubtitleSearchOverlay {
  private el: HTMLElement;
  private onPick: (r: OnlineSubtitleResult) => void;
  private onClose: () => void;
  private results: OnlineSubtitleResult[] = [];
  private focusIdx = 0;
  private isVisible = false;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, onPick: (r: OnlineSubtitleResult) => void, onClose: () => void) {
    this.el = container;
    this.onPick = onPick;
    this.onClose = onClose;
    this.el.addEventListener('mouseup', (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-result-index]');
      if (!row) return;
      const i = Number(row.dataset.resultIndex);
      if (!Number.isNaN(i)) this.pick(i);
    });
  }

  get visible(): boolean { return this.isVisible; }

  open(results: OnlineSubtitleResult[], _preferredLanguage: string): void {
    this.clearStatusTimer();
    this.results = results;
    this.focusIdx = 0;
    this.isVisible = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  /** Show a status line. `autoClose` dismisses the overlay after a few seconds —
   *  used for terminal messages (errors / "no results") so a failed download
   *  doesn't leave the overlay stuck until the user presses Back. */
  showStatus(message: string, autoClose = false): void {
    this.clearStatusTimer();
    this.isVisible = true;
    this.el.classList.remove('hidden');
    morph(this.el, html`<div class="subs-overlay"><div class="subs-status">${message}</div></div>`);
    if (autoClose) {
      this.statusTimer = setTimeout(() => { this.close(); this.onClose(); }, STATUS_AUTO_HIDE_MS);
    }
  }

  close(): void {
    this.clearStatusTimer();
    this.isVisible = false;
    this.el.classList.add('hidden');
    this.results = [];
  }

  private clearStatusTimer(): void {
    if (this.statusTimer) { clearTimeout(this.statusTimer); this.statusTimer = null; }
  }

  handleAction(action: Action): void {
    if (!this.isVisible) return;
    if (action === 'back') { this.close(); this.onClose(); return; }
    if (!this.results.length) return;
    if (action === 'up') this.focusIdx = Math.max(0, this.focusIdx - 1);
    else if (action === 'down') this.focusIdx = Math.min(this.results.length - 1, this.focusIdx + 1);
    else if (action === 'select') { this.pick(this.focusIdx); return; }
    this.render();
    this.el.querySelector<HTMLElement>('.subs-row.focused')?.scrollIntoView?.({ block: 'nearest' });
  }

  private pick(i: number): void {
    const r = this.results[i];
    if (r) this.onPick(r);
  }

  private label(r: OnlineSubtitleResult): string {
    const lang = r.language ? languageName(r.language) : '';
    const parts = [PROVIDER_LABEL[r.providerId] ?? r.providerId, lang, r.releaseName].filter(Boolean);
    let s = parts.join(' · ');
    if (r.hearingImpaired) s += ' · HI';
    return s;
  }

  private render(): void {
    morph(this.el, html`
      <div class="subs-overlay">
        <div class="subs-overlay-header">Online Subtitles</div>
        <div class="subs-list">
          ${this.results.map((r, i) => html`
            <div class="subs-row ${i === this.focusIdx ? 'focused' : ''}"
                 data-key="${r.providerId}:${r.id}:${i}" data-focusable data-result-index="${i}">
              <span class="subs-row-label">${this.label(r)}</span>
              ${r.downloads ? html`<span class="subs-count" title="Downloads">${raw(DOWNLOAD_ICON)}${formatCount(r.downloads)}</span>` : ''}
            </div>
          `)}
        </div>
      </div>
    `);
  }
}
