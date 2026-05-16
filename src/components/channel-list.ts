import type { Action, NumberEvent } from '../types';
import { SpatialNav } from '../navigation/spatial-nav';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { StorageService } from '../services/storage-service';

export class ChannelList {
  private container: HTMLElement;
  private onChannelSelect: (index: number) => void;
  private nav: SpatialNav;
  private currentGroup = 'All';
  private currentPlaylist = '';  // '' = All playlists
  private playingIndex = -1;

  constructor(container: HTMLElement, onChannelSelect: (index: number) => void) {
    this.container = container;
    this.onChannelSelect = onChannelSelect;
    this.nav = new SpatialNav(container);
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

    this.container.innerHTML = `
      <div class="channel-view">
        <div class="sidebar" data-nav-container>
          <div class="sidebar-header">
            <h2>webOS IPTV Player</h2>
            <div class="channel-count">${totalChannels} channels</div>
          </div>
          ${showTabs ? `
            <div class="playlist-tabs">
              <div class="playlist-tab ${!this.currentPlaylist ? 'active' : ''}"
                   data-focusable data-playlist="">All</div>
              ${plNames.map(name => `
                <div class="playlist-tab ${name === this.currentPlaylist ? 'active' : ''}"
                     data-focusable data-playlist="${name}">${name}</div>
              `).join('')}
            </div>
          ` : ''}
          <div class="group-list">
            ${groups.map(g => `
              <div class="group-item ${g === this.currentGroup ? 'active' : ''}"
                   data-focusable data-group="${g}">
                <span class="group-icon">${groupIcon(g)}</span>
                <span class="group-name">${g}</span>
                <span class="group-count">${PlaylistService.getByGroup(g, this.currentPlaylist || undefined).length}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="channel-main" data-nav-container>
          <div class="channel-list-scroll">
            ${filteredChannels.length === 0
              ? '<div class="empty-state">No channels found</div>'
              : filteredChannels.map(ch => {
                  const globalIdx = PlaylistService.indexOf(ch);
                  const epgId = EpgService.findChannelId(ch);
                  const nowPlaying = epgId ? EpgService.getNowPlaying(epgId) : null;
                  const isPlaying = globalIdx === this.playingIndex;
                  const isFav = favs.includes(ch.id || ch.name);

                  return `
                    <div class="channel-item ${isPlaying ? 'playing' : ''}"
                         data-focusable data-channel-index="${globalIdx}">
                      <div class="channel-number">${globalIdx + 1}</div>
                      <div class="channel-logo-wrap">
                        ${ch.logo
                          ? `<img class="channel-logo" src="${ch.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`
                          : `<div class="channel-logo-placeholder">${ch.name.charAt(0)}</div>`}
                      </div>
                      <div class="channel-info">
                        <div class="channel-name">${isFav ? '&#9733; ' : ''}${ch.name}</div>
                        ${nowPlaying ? `<div class="channel-now">${nowPlaying.title}</div>` : ''}
                      </div>
                      ${isPlaying ? '<div class="playing-indicator">&#9654;</div>' : ''}
                    </div>
                  `;
                }).join('')}
          </div>
        </div>
      </div>
    `;

    this.nav = new SpatialNav(this.container);
    const playingChannel = this.playingIndex >= 0
      ? this.container.querySelector<HTMLElement>(`.channel-main [data-channel-index="${this.playingIndex}"]`)
      : null;
    const target = playingChannel
      ?? this.container.querySelector<HTMLElement>('.channel-main [data-focusable]');
    if (target) {
      this.nav.focus(target);
      if (playingChannel) playingChannel.scrollIntoView({ block: 'center' });
    } else {
      this.nav.focusFirst();
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

        if (focused.dataset.playlist !== undefined) {
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
