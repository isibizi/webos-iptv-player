import type { Action, NumberEvent, CatchupInfo, Programme } from '../types';
import { html, raw } from '../utils/dom';
import { morph } from '../utils/morph';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { formatTime, isNow } from '../utils/time';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

type FocusCol = 'channels' | 'dates' | 'programmes';

function formatDateLabel(d: Date): { weekday: string; date: string } {
  return {
    weekday: WEEKDAYS[d.getDay()],
    date: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
  };
}

export class EpgGrid {
  private container: HTMLElement;
  private onChannelSelect: (index: number, catchup?: CatchupInfo) => void;
  private selectedChannelIdx = 0;
  private selectedDay = 0;
  private dayInitialized = false;
  private focusCol: FocusCol = 'channels';
  private focusProg = 0;

  constructor(container: HTMLElement, onChannelSelect: (index: number, catchup?: CatchupInfo) => void) {
    this.container = container;
    this.onChannelSelect = onChannelSelect;
    this.bindEvents();
  }

  private getDateOptions(): Date[] {
    let minStart = Infinity;
    let maxStop = -Infinity;
    for (const progs of Object.values(EpgService.programmes)) {
      if (!progs.length) continue;
      const first = progs[0].start.getTime();
      const last = progs[progs.length - 1].stop.getTime();
      if (first < minStart) minStart = first;
      if (last > maxStop) maxStop = last;
    }
    if (minStart === Infinity) return [];

    const firstDay = new Date(minStart);
    firstDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(maxStop);
    lastDay.setHours(0, 0, 0, 0);

    const opts: Date[] = [];
    const cur = new Date(firstDay);
    while (cur.getTime() <= lastDay.getTime()) {
      opts.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return opts;
  }

  private findTodayIndex(options: Date[]): number {
    if (!options.length) return 0;
    const todayMs = todayMidnight().getTime();
    for (let i = 0; i < options.length; i++) {
      if (options[i].getTime() === todayMs) return i;
    }
    return todayMs < options[0].getTime() ? 0 : options.length - 1;
  }

  private getCurrentProgrammes(): Programme[] {
    const channel = PlaylistService.channels[this.selectedChannelIdx];
    if (!channel) return [];
    const epgId = EpgService.findChannelId(channel);
    if (!epgId) return [];
    const options = this.getDateOptions();
    const dayStart = options[this.selectedDay];
    if (!dayStart) return [];
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return EpgService.getProgrammesInRange(epgId, dayStart, dayEnd);
  }

  render(): void {
    const channels = PlaylistService.channels;
    const channel = channels[this.selectedChannelIdx];
    const dateOptions = this.getDateOptions();
    if (dateOptions.length > 0) {
      if (!this.dayInitialized) {
        this.selectedDay = this.findTodayIndex(dateOptions);
        this.dayInitialized = true;
      } else {
        this.selectedDay = Math.max(0, Math.min(this.selectedDay, dateOptions.length - 1));
      }
    }
    const todayMs = todayMidnight().getTime();
    const programmes = this.getCurrentProgrammes();

    morph(this.container, html`
      <div class="epg-view">
        <div class="epg-header">
          <h2>Programme Guide</h2>
          <span class="epg-page-info">${channel?.name ?? ''}${programmes.length ? html` · ${programmes.length} programmes` : ''}</span>
        </div>
        <div class="epg-main">
          <div class="epg-channels-pane ${this.focusCol === 'channels' ? 'pane-focused' : ''}" id="epg-channels">
            ${channels.map((ch, i) => {
              const sel = i === this.selectedChannelIdx;
              const foc = sel && this.focusCol === 'channels';
              return html`
                <div class="epg-channel-item ${sel ? 'selected' : ''} ${foc ? 'focused' : ''}"
                     data-key="${ch.id || ch.name || String(i)}"
                     data-channel-idx="${i}">
                  <span class="epg-ch-num">${i + 1}</span>
                  <span class="epg-ch-name">${ch.name}</span>
                </div>
              `;
            })}
          </div>
          <div class="epg-right-pane">
            <div class="epg-date-bar ${this.focusCol === 'dates' ? 'pane-focused' : ''}" id="epg-dates">
              ${dateOptions.map((d, i) => {
                const sel = i === this.selectedDay;
                const foc = sel && this.focusCol === 'dates';
                const isToday = d.getTime() === todayMs;
                const lbl = formatDateLabel(d);
                return html`
                  <div class="epg-date-item ${sel ? 'selected' : ''} ${foc ? 'focused' : ''} ${isToday ? 'today' : ''}"
                       data-key="${d.toISOString().slice(0, 10)}"
                       data-day-index="${i}">
                    <span class="epg-date-weekday">${lbl.weekday}</span>
                    <span class="epg-date-date">${lbl.date}</span>
                  </div>
                `;
              })}
            </div>
            <div class="epg-programmes-pane ${this.focusCol === 'programmes' ? 'pane-focused' : ''}" id="epg-programmes">
              ${programmes.length === 0
                ? raw('<div class="epg-no-data">No programme data</div>')
                : programmes.map((p, i) => {
                    const foc = i === this.focusProg && this.focusCol === 'programmes';
                    const current = isNow(p.start, p.stop);
                    return html`
                      <div class="epg-programme-item ${foc ? 'focused' : ''} ${current ? 'current' : ''}"
                           data-key="${String(p.start.getTime())}"
                           data-prog-idx="${i}">
                        <span class="epg-prog-time">${formatTime(p.start)}</span>
                        <div class="epg-prog-body">
                          <div class="epg-prog-title">
                            ${current ? raw('<span class="epg-now-badge">NOW</span>') : ''}
                            ${p.title}
                          </div>
                          ${p.description ? html`<div class="epg-prog-desc">${p.description.slice(0, 200)}</div>` : ''}
                        </div>
                      </div>
                    `;
                  })
              }
            </div>
          </div>
        </div>
      </div>
    `);

    this.scrollFocusedIntoView();
  }

  private bindEvents(): void {
    // Delegated handlers attached once to the persistent container. With morph
    // reusing nodes across renders, per-render addEventListener would stack up.
    this.container.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const channelItem = target.closest<HTMLElement>('#epg-channels [data-channel-idx]');
      if (channelItem) {
        const idx = parseInt(channelItem.dataset.channelIdx!, 10);
        if (idx === this.selectedChannelIdx && this.focusCol === 'channels') {
          this.onChannelSelect(idx);
        } else {
          this.selectedChannelIdx = idx;
          this.focusCol = 'channels';
          this.focusProg = 0;
          this.render();
        }
        return;
      }
      const dateItem = target.closest<HTMLElement>('#epg-dates [data-day-index]');
      if (dateItem) {
        this.selectedDay = parseInt(dateItem.dataset.dayIndex!, 10);
        this.focusCol = 'dates';
        this.focusProg = 0;
        this.render();
        return;
      }
      const progItem = target.closest<HTMLElement>('#epg-programmes [data-prog-idx]');
      if (progItem) {
        this.focusProg = parseInt(progItem.dataset.progIdx!, 10);
        this.focusCol = 'programmes';
        this.playSelectedProgramme();
      }
    });

    this.container.addEventListener('mouseover', (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('#epg-programmes [data-prog-idx]');
      if (!item) return;
      this.setProgFocusLight(parseInt(item.dataset.progIdx!, 10));
    });
  }

  private setProgFocusLight(idx: number): void {
    if (this.focusProg === idx && this.focusCol === 'programmes') return;
    this.container.querySelectorAll('.epg-programme-item.focused').forEach(el => el.classList.remove('focused'));
    this.container.querySelector<HTMLElement>(`[data-prog-idx="${idx}"]`)?.classList.add('focused');
    this.focusProg = idx;
    if (this.focusCol !== 'programmes') {
      this.focusCol = 'programmes';
      this.container.querySelectorAll('.pane-focused').forEach(el => el.classList.remove('pane-focused'));
      this.container.querySelector('.epg-programmes-pane')?.classList.add('pane-focused');
    }
  }

  private scrollFocusedIntoView(): void {
    const map: Record<FocusCol, string> = {
      channels: '.epg-channel-item.focused',
      dates: '.epg-date-item.focused',
      programmes: '.epg-programme-item.focused',
    };
    const el = this.container.querySelector<HTMLElement>(map[this.focusCol]);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private playSelectedProgramme(): void {
    const programmes = this.getCurrentProgrammes();
    const prog = programmes[this.focusProg];
    if (!prog) return;
    const now = Math.floor(Date.now() / 1000);
    const progStart = Math.floor(prog.start.getTime() / 1000);
    const progStop = Math.floor(prog.stop.getTime() / 1000);

    let catchup: CatchupInfo | undefined;
    if (progStart < now && progStop) {
      catchup = {
        start: progStart,
        end: progStop,
        title: prog.title,
        description: prog.description || '',
        icon: prog.icon || '',
      };
    }
    this.onChannelSelect(this.selectedChannelIdx, catchup);
  }

  handleAction(action: Action, _event?: NumberEvent): void {
    const channelCount = PlaylistService.channels.length;
    const progCount = this.getCurrentProgrammes().length;

    switch (action) {
      case 'up':
        if (this.focusCol === 'channels') {
          if (this.selectedChannelIdx > 0) {
            this.selectedChannelIdx--;
            this.focusProg = 0;
            this.render();
          }
        } else if (this.focusCol === 'programmes') {
          if (this.focusProg > 0) {
            this.focusProg--;
            this.render();
          } else {
            this.focusCol = 'dates';
            this.render();
          }
        }
        break;

      case 'down':
        if (this.focusCol === 'channels') {
          if (this.selectedChannelIdx < channelCount - 1) {
            this.selectedChannelIdx++;
            this.focusProg = 0;
            this.render();
          }
        } else if (this.focusCol === 'dates') {
          this.focusCol = 'programmes';
          this.focusProg = 0;
          this.render();
        } else if (this.focusCol === 'programmes') {
          if (this.focusProg < progCount - 1) {
            this.focusProg++;
            this.render();
          }
        }
        break;

      case 'left':
        if (this.focusCol === 'dates') {
          if (this.selectedDay > 0) {
            this.selectedDay--;
            this.focusProg = 0;
            this.render();
          }
        } else if (this.focusCol === 'programmes') {
          this.focusCol = 'channels';
          this.render();
        }
        break;

      case 'right':
        if (this.focusCol === 'channels') {
          this.focusCol = 'programmes';
          this.focusProg = 0;
          this.render();
        } else if (this.focusCol === 'dates') {
          const total = this.getDateOptions().length;
          if (this.selectedDay < total - 1) {
            this.selectedDay++;
            this.focusProg = 0;
            this.render();
          }
        }
        break;

      case 'channel_up':
        if (this.focusCol === 'channels') {
          this.selectedChannelIdx = Math.max(0, this.selectedChannelIdx - 10);
          this.focusProg = 0;
        } else if (this.focusCol === 'programmes') {
          this.focusProg = Math.max(0, this.focusProg - 10);
        }
        this.render();
        break;

      case 'channel_down':
        if (this.focusCol === 'channels') {
          this.selectedChannelIdx = Math.min(channelCount - 1, this.selectedChannelIdx + 10);
          this.focusProg = 0;
        } else if (this.focusCol === 'programmes') {
          this.focusProg = Math.min(progCount - 1, this.focusProg + 10);
        }
        this.render();
        break;

      case 'select':
        if (this.focusCol === 'channels') {
          this.onChannelSelect(this.selectedChannelIdx);
        } else if (this.focusCol === 'programmes') {
          this.playSelectedProgramme();
        } else if (this.focusCol === 'dates') {
          this.focusCol = 'programmes';
          this.focusProg = 0;
          this.render();
        }
        break;

      case 'green':
        this.selectedDay = this.findTodayIndex(this.getDateOptions());
        this.focusProg = 0;
        this.render();
        break;
    }
  }
}
