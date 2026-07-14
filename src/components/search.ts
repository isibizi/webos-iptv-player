import type { Action, Channel, PlaylistEntry, VodItem, SeriesItem } from '../types';
import { SpatialNav } from '../navigation/spatial-nav';
import { html } from '../utils/dom';
import { morph } from '../utils/morph';
import { PlaylistService } from '../services/playlist-service';
import { loadAllVodStreams, loadAllSeries } from '../services/xtream-catalog';
import { rankByName } from '../utils/channel-search';
import { CONFIG } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('Search');

export interface SearchHandlers {
  onRevealTabBar: () => void;
  onBack: () => void;
  onPlayChannel: (index: number) => void;
  onOpenMovie: (account: PlaylistEntry, vod: VodItem) => void;
  onOpenSeries: (account: PlaylistEntry, series: SeriesItem) => void;
}

// The Search section: one query box over three result rails (Channels / Movies /
// Series). All three are relevance-ranked by name (rankByName) and capped; movies
// and series match the account's full catalogs, loaded once on open and cached.
// Up from the box reveals the tab bar; Back returns to Live. The global key
// handler ignores INPUT keydowns, so the box owns its own text input + focus-out
// keys.
export class Search {
  private nav: SpatialNav;
  private account: PlaylistEntry | null = null;
  private query = '';
  private allVod: VodItem[] = [];
  private allSeries: SeriesItem[] = [];
  private loadedFor: string | null = null;

  constructor(private container: HTMLElement, private handlers: SearchHandlers) {
    this.nav = new SpatialNav(container);
    this.container.addEventListener('mouseleave', () => this.nav.clearHighlight());
    // Activate the result under the pointer by coordinate hit-test, so it lands
    // here regardless of D-pad focus; the container is marked `data-self-activate`
    // so the global click handler skips this subtree and doesn't double-fire.
    this.container.setAttribute('data-self-activate', '');
    this.container.addEventListener('click', (e: MouseEvent) => this.onPointerRelease(e.clientX, e.clientY));
  }

  private onPointerRelease(x: number, y: number): void {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-focusable]');
    if (!el || !this.container.contains(el)) return;
    this.nav.focus(el);
    this.onSelect();
  }

  async open(account: PlaylistEntry | null): Promise<void> {
    this.account = account;
    this.query = '';
    this.render();
    if (account) await this.loadCatalog(account);
  }

  /** The tab bar's search box drives the query; re-render the results for it. */
  setQuery(query: string): void {
    this.query = query;
    this.render();
  }

  handleAction(action: Action): void {
    switch (action) {
      case 'up':
        if (!this.nav.move('up')) this.handlers.onRevealTabBar();
        return;
      case 'down':
      case 'left':
      case 'right':
        this.nav.move(action);
        return;
      case 'select':
        this.onSelect();
        return;
      case 'back':
        this.handlers.onBack();
        return;
      default:
        return;
    }
  }

  // Load the whole catalogs once per account (cached in IndexedDB), guarding
  // against account-switch races so a stale in-flight load can't clobber the
  // current account's catalog. Non-blocking: open() already rendered the box.
  private async loadCatalog(account: PlaylistEntry): Promise<void> {
    if (this.loadedFor === account.id) return;
    try {
      const [vod, series] = await Promise.all([loadAllVodStreams(account), loadAllSeries(account)]);
      // A newer open() (account switch) superseded this load — discard the stale
      // result instead of clobbering the current account's catalog.
      if (this.account?.id !== account.id) return;
      this.allVod = vod;
      this.allSeries = series;
      this.loadedFor = account.id;
      log.debug('catalog loaded', vod.length, 'movies,', series.length, 'series');
      if (this.query.trim()) this.render();
    } catch (err) {
      log.error('catalog load failed:', err);
    }
  }

  private onSelect(): void {
    const el = this.nav.focused;
    if (!el) return;
    if (el.classList.contains('search-input')) {
      const input = el as HTMLInputElement;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (el.dataset.channelIndex !== undefined) {
      this.handlers.onPlayChannel(parseInt(el.dataset.channelIndex, 10));
    } else if (this.account && el.dataset.streamId !== undefined) {
      const v = this.allVod.find((x) => x.streamId === el.dataset.streamId);
      if (v) this.handlers.onOpenMovie(this.account, v);
    } else if (this.account && el.dataset.seriesId !== undefined) {
      const s = this.allSeries.find((x) => x.seriesId === el.dataset.seriesId);
      if (s) this.handlers.onOpenSeries(this.account, s);
    }
  }

  /** Move focus into the first result (called when the tab bar's search box
   *  hands off with Enter / Down). */
  focusFirstResult(): void {
    const first = this.container.querySelector<HTMLElement>('.search-results [data-focusable]');
    if (first) this.nav.focus(first);
  }

  private posterCell(name: string, poster: string): ReturnType<typeof html> {
    return poster
      ? html`<img class="catalog-poster" src="${poster}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : html`<div class="catalog-poster catalog-poster-empty">${name.charAt(0)}</div>`;
  }

  private rail(title: string, items: ReturnType<typeof html>[]): ReturnType<typeof html> {
    return html`
      <div class="catalog-rail">
        <h2 class="catalog-rail-title">${title}</h2>
        <div class="catalog-rail-track">${items}</div>
      </div>
    `;
  }

  private channelTile(ch: Channel): ReturnType<typeof html> {
    const idx = PlaylistService.indexOf(ch);
    return html`
      <div class="catalog-tile search-channel-tile" data-focusable data-key="ch:${String(idx)}"
           data-channel-index="${String(idx)}">
        <div class="catalog-poster-wrap">${this.posterCell(ch.name, ch.logo)}</div>
        <div class="catalog-tile-name">${ch.name}</div>
      </div>
    `;
  }

  // A vertical-list row (logo + name) used for the M3U-only channel results.
  private channelRow(ch: Channel): ReturnType<typeof html> {
    const idx = PlaylistService.indexOf(ch);
    return html`
      <div class="search-channel-row" data-focusable data-key="ch:${String(idx)}"
           data-channel-index="${String(idx)}">
        ${ch.logo
          ? html`<img class="search-row-logo" src="${ch.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : html`<div class="search-row-logo search-row-logo-empty">${ch.name.charAt(0)}</div>`}
        <span class="search-row-name">${ch.name}</span>
      </div>
    `;
  }

  private movieTile(v: VodItem): ReturnType<typeof html> {
    return html`
      <div class="catalog-tile" data-focusable data-key="v:${v.streamId}" data-stream-id="${v.streamId}">
        <div class="catalog-poster-wrap">${this.posterCell(v.name, v.poster)}</div>
        <div class="catalog-tile-name">${v.name}</div>
      </div>
    `;
  }

  private seriesTile(s: SeriesItem): ReturnType<typeof html> {
    return html`
      <div class="catalog-tile" data-focusable data-key="s:${s.seriesId}" data-series-id="${s.seriesId}">
        <div class="catalog-poster-wrap">${this.posterCell(s.name, s.poster)}</div>
        <div class="catalog-tile-name">${s.name}</div>
      </div>
    `;
  }

  private render(): void {
    const cap = CONFIG.XTREAM.SEARCH_RESULT_CAP;
    const q = this.query.trim();
    const channels = q ? PlaylistService.search(this.query).slice(0, cap) : [];
    const isXtream = !!this.account;

    // Xtream: horizontal poster rails across Channels / Movies / Series.
    // M3U-only: a vertical list of channel results.
    const movies = isXtream ? rankByName(this.allVod, this.query).slice(0, cap) : [];
    const series = isXtream ? rankByName(this.allSeries, this.query).slice(0, cap) : [];
    const hasResults = channels.length > 0 || movies.length > 0 || series.length > 0;

    // The results view is only shown while a query is typed (App.handleSearchQuery),
    // so the empty-query case renders nothing.
    const resultsBody = !q
      ? html``
      : !hasResults
        ? html`<p class="catalog-hint search-empty">No results match your search.</p>`
        : isXtream
          ? html`
                ${channels.length ? this.rail('Channels', channels.map((ch) => this.channelTile(ch))) : ''}
                ${movies.length ? this.rail('Movies', movies.map((v) => this.movieTile(v))) : ''}
                ${series.length ? this.rail('Series', series.map((s) => this.seriesTile(s))) : ''}
              `
          : html`<div class="search-list">${channels.map((ch) => this.channelRow(ch))}</div>`;

    // The query box lives in the tab bar; this view renders results only.
    morph(this.container, html`
      <div class="search-view" data-nav-container>
        <div class="search-results">${resultsBody}</div>
      </div>
    `);
  }
}
