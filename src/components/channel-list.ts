import type { Action, NumberEvent } from '../types';
import { SpatialNav } from '../navigation/spatial-nav';
import { html, raw } from '../utils/dom';
import { morph } from '../utils/morph';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { StorageService } from '../services/storage-service';

export class ChannelList {
  private container: HTMLElement;
  private onChannelSelect: (index: number) => void;
  private onOpenSettings: () => void;
  private nav: SpatialNav;
  private currentGroup = 'All';
  private currentPlaylist = '';  // '' = All playlists
  private playingIndex = -1;

  constructor(
    container: HTMLElement,
    onChannelSelect: (index: number) => void,
    onOpenSettings: () => void,
  ) {
    this.container = container;
    this.onChannelSelect = onChannelSelect;
    this.onOpenSettings = onOpenSettings;
    this.nav = new SpatialNav(container);

    // Bind once: the settings gear lives inside morph's reused subtree, so a
    // per-render addEventListener would stack up handlers.
    this.container.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.settings-btn');
      if (btn) this.onOpenSettings();
    });
  }

  render(): void {
    const plNames = PlaylistService.playlistNames;
    const showTabs = plNames.length > 1;
    const groups = ['All', 'Favorites', ...PlaylistService.getGroupsForPlaylist(this.currentPlaylist || undefined)];
    const filteredChannels = PlaylistService.getByGroup(this.currentGroup, this.currentPlaylist || undefined);
    const totalChannels = this.currentPlaylist
      ? PlaylistService.getByGroup('All', this.currentPlaylist).length
      : PlaylistService.channels.length;
    const favs = StorageService.getFavorites();

    // Capture the current focus key before morph so we can restore it on a
    // reused node. morph treats `class` as authoritative — it will remove the
    // imperative `.focused` class — and we re-apply nav.focus in the same
    // synchronous tick to avoid any flicker.
    const prevFocusedKey = this.nav.focused?.getAttribute('data-key') ?? null;

    morph(this.container, html`
      <div class="channel-view">
        <div class="sidebar" data-nav-container>
          <div class="sidebar-header">
            <div class="sidebar-title">
              <h2>webOS IPTV Player</h2>
              <div class="channel-count">${totalChannels} channels</div>
            </div>
            <div class="settings-btn" data-focusable data-action="settings"
                 data-key="settings"
                 title="Settings">&#9881;</div>
          </div>
          ${showTabs ? html`
            <div class="playlist-tabs">
              <div class="playlist-tab ${!this.currentPlaylist ? 'active' : ''}"
                   data-key="tab:"
                   data-focusable data-playlist="">All</div>
              ${plNames.map(name => html`
                <div class="playlist-tab ${name === this.currentPlaylist ? 'active' : ''}"
                     data-key="tab:${name}"
                     data-focusable data-playlist="${name}">${name}</div>
              `)}
            </div>
          ` : ''}
          <div class="group-list">
            ${groups.map(g => html`
              <div class="group-item ${g === this.currentGroup ? 'active' : ''}"
                   data-key="g:${g}"
                   data-focusable data-group="${g}">
                <span class="group-icon">${raw(groupIcon(g))}</span>
                <span class="group-name">${g}</span>
                <span class="group-count">${PlaylistService.getByGroup(g, this.currentPlaylist || undefined).length}</span>
              </div>
            `)}
          </div>
        </div>
        <div class="channel-main" data-nav-container>
          <div class="channel-list-scroll">
            ${filteredChannels.length === 0
              ? raw('<div class="empty-state">No channels found</div>')
              : filteredChannels.map(ch => {
                  const globalIdx = PlaylistService.indexOf(ch);
                  const epgId = EpgService.findChannelId(ch);
                  const nowPlaying = epgId ? EpgService.getNowPlaying(epgId) : null;
                  const isPlaying = globalIdx === this.playingIndex;
                  const isFav = favs.includes(ch.id || ch.name);

                  return html`
                    <div class="channel-item ${isPlaying ? 'playing' : ''}"
                         data-key="ch:${String(globalIdx)}"
                         data-focusable data-channel-index="${globalIdx}">
                      <div class="channel-number">${globalIdx + 1}</div>
                      <div class="channel-logo-wrap">
                        ${ch.logo
                          ? html`<img class="channel-logo" src="${ch.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`
                          : html`<div class="channel-logo-placeholder">${ch.name.charAt(0)}</div>`}
                      </div>
                      <div class="channel-info">
                        <div class="channel-name">${isFav ? raw('&#9733; ') : ''}${ch.name}</div>
                        ${nowPlaying ? html`<div class="channel-now">${nowPlaying.title}</div>` : ''}
                      </div>
                      ${isPlaying ? raw('<div class="playing-indicator">&#9654;</div>') : ''}
                    </div>
                  `;
                })}
          </div>
        </div>
      </div>
    `);

    // Restore focus on the reused node (or fall back to a sensible default).
    let target: HTMLElement | null = null;
    if (prevFocusedKey) {
      target = this.container.querySelector<HTMLElement>(
        `[data-key="${attrSelectorEscape(prevFocusedKey)}"]`,
      );
    }
    let playingChannel: HTMLElement | null = null;
    if (!target) {
      playingChannel = this.playingIndex >= 0
        ? this.container.querySelector<HTMLElement>(`.channel-main [data-channel-index="${this.playingIndex}"]`)
        : null;
      // Initial focus should land on content, never on the settings gear.
      target = playingChannel
        ?? this.container.querySelector<HTMLElement>('.channel-main [data-focusable]')
        ?? this.container.querySelector<HTMLElement>('.group-list [data-focusable]')
        ?? this.container.querySelector<HTMLElement>('[data-focusable]:not(.settings-btn)');
    }
    if (target) {
      this.nav.focus(target);
      if (playingChannel) playingChannel.scrollIntoView({ block: 'center' });
    }
  }

  handleAction(action: Action, event?: NumberEvent): void {
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.nav.move(action);
        break;

      case 'channel_up':
        this.nav.move('up');
        break;

      case 'channel_down':
        this.nav.move('down');
        break;

      case 'select': {
        const focused = this.nav.focused;
        if (!focused) break;

        if (focused.dataset.action === 'settings') {
          this.onOpenSettings();
        } else if (focused.dataset.playlist !== undefined) {
          this.currentPlaylist = focused.dataset.playlist;
          this.currentGroup = 'All';
          this.render();
        } else if (focused.dataset.group !== undefined) {
          this.currentGroup = focused.dataset.group;
          this.render();
        } else if (focused.dataset.channelIndex !== undefined) {
          const idx = parseInt(focused.dataset.channelIndex, 10);
          this.playingIndex = idx;
          this.onChannelSelect(idx);
        }
        break;
      }

      case 'green': {
        const focused = this.nav.focused;
        if (focused?.dataset.channelIndex !== undefined) {
          const idx = parseInt(focused.dataset.channelIndex, 10);
          const ch = PlaylistService.getByIndex(idx);
          if (ch) {
            StorageService.toggleFavorite(ch.id || ch.name);
            this.render();
          }
        }
        break;
      }

      case 'number': {
        if (!event) break;
        const num = event.number - 1;
        if (num >= 0 && num < PlaylistService.channels.length) {
          this.playingIndex = num;
          this.onChannelSelect(num);
        }
        break;
      }
    }
  }

  setPlayingIndex(idx: number): void {
    this.playingIndex = idx;
  }
}

function groupIcon(group: string): string {
  if (group === 'All') return '<span class="icon-all"></span>';
  if (group === 'Favorites') return '&#9733;';
  return '&#9654;';
}

// Escape a value for use inside a `[attr="..."]` selector. Only `\` and `"`
// matter. Avoids relying on `CSS.escape` which jsdom does not implement.
function attrSelectorEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
