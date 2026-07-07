import type { PlaylistEntry, VodCategory, VodItem, VodInfo, ResumeKind } from '../types';
import { html, raw, Safe } from '../utils/dom';
import { morph } from '../utils/morph';
import { StorageService } from '../services/storage-service';
import { loadVodCategories, loadVodStreams, loadVodInfo } from '../services/xtream-catalog';
import { xtreamVodUrl } from '../utils/xtream-url';
import { CatalogView } from './catalog-view';

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

// The Movies section: browse (Continue rail + per-category rails + an "all
// categories" drill-in) → per-category poster grid → a detail screen with
// Play / Resume. The browse/grid/nav machinery lives in CatalogView.
export class Movies extends CatalogView<VodCategory, VodItem> {
  protected readonly kicker = 'Movies';
  protected readonly resumeKind: ResumeKind = 'vod';
  protected readonly emptyMessage = 'No movies available on this account.';
  protected readonly gridEmptyMessage = 'No movies in this category.';

  private currentVod: VodItem | null = null;
  private currentInfo: VodInfo | null = null;

  protected loadCategories(account: PlaylistEntry): Promise<VodCategory[]> { return loadVodCategories(account); }
  protected loadItems(account: PlaylistEntry, categoryId: string): Promise<VodItem[]> { return loadVodStreams(account, categoryId); }
  protected itemId(v: VodItem): string { return v.streamId; }
  protected itemName(v: VodItem): string { return v.name; }
  protected itemPoster(v: VodItem): string { return v.poster; }
  protected itemCategoryId(v: VodItem): string { return v.categoryId; }
  protected clearDetail(): void { this.currentVod = null; }

  // A Continue-rail tile has no loaded VodItem; synthesize a minimal one so the
  // detail screen (and hero) can resolve it (full info is fetched in detail).
  protected resumeFallback(streamId: string): VodItem | null { return this.resumeToVod(streamId); }
  protected heroFallback(): VodItem | null { return this.resumeToVod(this.resume[0]?.itemId ?? ''); }

  private resumeToVod(streamId: string): VodItem | null {
    const r = this.resume.find((e) => e.itemId === streamId);
    if (!r) return null;
    return { accountId: r.accountId, streamId: r.itemId, name: r.name, poster: r.poster, rating: '', categoryId: '', containerExtension: r.ext };
  }

  protected continueRail(): Safe | '' {
    return this.resume.length
      ? this.rail('Continue Watching', this.resume.map((r) => this.tile(this.resumeToVod(r.itemId)!)))
      : '';
  }

  protected selectExtra(el: HTMLElement): boolean {
    if (el.dataset.action === 'play' || el.dataset.action === 'resume') {
      this.play(el.dataset.action === 'resume');
      return true;
    }
    return false;
  }

  protected async openDetail(vod: VodItem): Promise<void> {
    if (!this.account) return;
    this.currentVod = vod;
    this.mode = 'detail';
    this.currentInfo = null;
    this.renderDetail();
    this.currentInfo = await loadVodInfo(this.account, vod.streamId);
    if (this.mode === 'detail' && this.currentVod === vod) this.renderDetail();
  }

  private play(resume: boolean): void {
    const vod = this.currentVod;
    const a = this.account;
    if (!vod || !a) return;
    const saved = StorageService.getResume(a.id, 'vod', vod.streamId);
    this.handlers.onPlayVod({
      url: this.vodUrl(vod),
      title: vod.name,
      poster: this.currentInfo?.poster || vod.poster,
      accountId: a.id,
      itemId: vod.streamId,
      kind: 'vod',
      resumeSecs: resume && saved ? saved.position : 0,
    });
  }

  private vodUrl(vod: VodItem): string {
    const a = this.account!;
    return xtreamVodUrl(
      { baseUrl: a.url, username: a.xtream!.username, password: a.xtream!.password },
      vod.streamId,
      vod.containerExtension || 'mp4',
    );
  }

  protected renderDetail(): void {
    const vod = this.currentVod;
    const a = this.account;
    if (!vod || !a) return;
    const info = this.currentInfo;
    const saved = StorageService.getResume(a.id, 'vod', vod.streamId);
    const poster = info?.poster || vod.poster;
    const year = info ? (info.releaseDate.match(/\d{4}/) || [''])[0] : '';
    const mins = info && info.durationSecs > 0 ? `${Math.floor(info.durationSecs / 60)} min` : '';
    const meta = [year, mins, info?.genre, vod.rating].filter((s) => !!s);

    const prevKey = this.nav.focused?.getAttribute('data-key') ?? null;
    morph(this.container, html`
      <div class="catalog-view movies-detail" data-nav-container>
        <div class="detail-poster-wrap">${this.posterCell(vod.name, poster)}</div>
        <div class="detail-body">
          <h1 class="detail-title">${vod.name}</h1>
          <div class="detail-meta">${meta.join('  ·  ')}</div>
          ${info?.plot ? html`<p class="detail-plot">${info.plot}</p>` : ''}
          ${info?.cast ? html`<div class="detail-cast"><span class="detail-label">Cast</span> ${info.cast}</div>` : ''}
          ${info?.director ? html`<div class="detail-cast"><span class="detail-label">Director</span> ${info.director}</div>` : ''}
          <div class="detail-actions">
            ${saved ? html`
              <button class="detail-btn detail-btn-primary" data-focusable data-key="resume" data-action="resume">
                <span class="detail-btn-icon">${raw(PLAY_SVG)}</span>Resume
              </button>` : ''}
            <button class="detail-btn ${saved ? '' : 'detail-btn-primary'}" data-focusable data-key="play" data-action="play">
              <span class="detail-btn-icon">${raw(PLAY_SVG)}</span>${saved ? 'Play from start' : 'Play'}
            </button>
          </div>
        </div>
      </div>
    `);
    const restore = (prevKey && this.container.querySelector<HTMLElement>(`[data-focusable][data-key="${prevKey}"]`))
      || this.container.querySelector<HTMLElement>('[data-focusable]');
    this.nav.focus(restore);
  }
}
