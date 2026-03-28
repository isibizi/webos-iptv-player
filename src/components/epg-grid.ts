import type { Action, NumberEvent, CatchupInfo } from '../types';
import { $ } from '../utils/dom';
import { PlaylistService } from '../services/playlist-service';
import { EpgService } from '../services/epg-service';
import { CONFIG } from '../config';
import { formatTime, getTimeSlots, isNow } from '../utils/time';

const CHANNEL_COL_W = 200;
const GRID_W = 1920 - CHANNEL_COL_W;
const VISIBLE_HOURS = CONFIG.EPG.VISIBLE_HOURS;
const PX_PER_MIN = CONFIG.EPG.PIXELS_PER_MINUTE;

const DAY_LABELS = ['Today', 'Yesterday'];
for (let i = 2; i <= 7; i++) DAY_LABELS.push(`${i} days ago`);

export class EpgGrid {
  private container: HTMLElement;
  private onChannelSelect: (index: number, catchup?: CatchupInfo) => void;
  private startTime: Date;
  private selectedDay = 0;
  private focusRow = 0;
  private focusProg = 0;

  constructor(container: HTMLElement, onChannelSelect: (index: number, catchup?: CatchupInfo) => void) {
    this.container = container;
    this.onChannelSelect = onChannelSelect;
    this.startTime = this.roundToSlot(new Date());
  }

  render(): void {
    const channels = PlaylistService.channels;
    const slots = getTimeSlots(this.startTime, VISIBLE_HOURS, CONFIG.EPG.TIME_SLOT_MINUTES);
    const gridWidth = GRID_W;

    const now = new Date();
    const nowOffset = (now.getTime() - this.startTime.getTime()) / 60000 * PX_PER_MIN;
    const showNowLine = nowOffset >= 0 && nowOffset <= gridWidth;

    this.container.innerHTML = `
      <div class="epg-view">
        <div class="epg-header">
          <div class="epg-title">
            <h2>Programme Guide</h2>
            <span class="epg-page-info">${channels.length} channels</span>
          </div>
          <div class="epg-day-bar">
            ${DAY_LABELS.map((label, i) => `
              <div class="epg-day-btn ${i === this.selectedDay ? 'active' : ''}"
                   data-day-offset="${i}">${label}</div>
            `).join('')}
          </div>
        </div>
        <div class="epg-grid-container">
          <div class="epg-time-header">
            <div class="epg-channel-col-header"></div>
            ${slots.map(s => `
              <div class="epg-time-slot" style="width: ${CONFIG.EPG.TIME_SLOT_MINUTES * PX_PER_MIN}px">
                ${formatTime(s)}
              </div>
            `).join('')}
          </div>
          <div class="epg-body" id="epg-body">
            ${channels.map((ch, i) => this.renderRow(ch, i, gridWidth)).join('')}
            ${showNowLine ? `<div class="epg-now-line" style="left: ${CHANNEL_COL_W + nowOffset}px"></div>` : ''}
          </div>
        </div>
        <div class="epg-info-panel" id="epg-info"></div>
      </div>
    `;

    // Day bar click handler
    this.container.querySelectorAll<HTMLElement>('[data-day-offset]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectDay(parseInt(btn.dataset.dayOffset!, 10));
      });
    });

    // Click on programme
    const body = $('#epg-body', this.container);
    if (body) {
      body.addEventListener('click', (e: MouseEvent) => {
        const prog = (e.target as HTMLElement).closest<HTMLElement>('[data-channel-index]');
        if (prog) {
          const row = parseInt(prog.dataset.channelIndex!, 10);
          this.focusRow = row;
          this.focusProg = this.getProgIdx(prog);
          this.updateFocus();
          this.confirmSelect();
        }
      });

      // Hover highlights + show info panel
      body.addEventListener('mouseover', (e: MouseEvent) => {
        const prog = (e.target as HTMLElement).closest<HTMLElement>('[data-channel-index]');
        if (prog) {
          this.focusRow = parseInt(prog.dataset.channelIndex!, 10);
          this.focusProg = this.getProgIdx(prog);
          this.updateFocus();
        }
      });

    }

    this.clampFocus();
    this.updateFocus();
    this.scrollToFocus();
  }

  private getProgIdx(el: HTMLElement): number {
    const row = el.closest('.epg-row');
    if (!row) return 0;
    const progs = row.querySelectorAll<HTMLElement>('[data-channel-index]');
    for (let i = 0; i < progs.length; i++) {
      if (progs[i] === el) return i;
    }
    return 0;
  }

  private selectDay(dayOffset: number): void {
    this.selectedDay = dayOffset;
    const now = new Date();
    if (dayOffset === 0) {
      this.startTime = this.roundToSlot(now);
    } else {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - dayOffset);
      dayStart.setHours(0, 0, 0, 0);
      this.startTime = dayStart;
    }
    this.focusProg = 0;
    this.render();
  }

  private renderRow(channel: { id: string; name: string }, globalIdx: number, gridWidth: number): string {
    const epgId = EpgService.findChannelId(channel as Parameters<typeof EpgService.findChannelId>[0]);
    const endTime = new Date(this.startTime.getTime() + VISIBLE_HOURS * 3600000);
    const programmes = epgId
      ? EpgService.getProgrammesInRange(epgId, this.startTime, endTime)
      : [];

    let programmeBlocks = '';
    if (programmes.length) {
      for (const prog of programmes) {
        const startMs = Math.max(prog.start.getTime(), this.startTime.getTime());
        const endMs = Math.min(prog.stop.getTime(), endTime.getTime());
        const offsetMin = (startMs - this.startTime.getTime()) / 60000;
        const durationMin = (endMs - startMs) / 60000;
        const left = offsetMin * PX_PER_MIN;
        const width = Math.max(durationMin * PX_PER_MIN - 2, 20);
        const current = isNow(prog.start, prog.stop);

        const safeDesc = (prog.description || '').slice(0, 200).replace(/"/g, '&quot;');
        programmeBlocks += `
          <div class="epg-programme ${current ? 'current' : ''}"
               data-channel-index="${globalIdx}"
               data-prog-start="${Math.floor(prog.start.getTime() / 1000)}"
               data-prog-stop="${Math.floor(prog.stop.getTime() / 1000)}"
               data-prog-title="${prog.title.replace(/"/g, '&quot;')}"
               data-prog-desc="${safeDesc}"
               data-prog-time="${formatTime(prog.start)} - ${formatTime(prog.stop)}"
               data-prog-icon="${(prog.icon || '').replace(/"/g, '&quot;')}"
               style="left: ${left}px; width: ${width}px">
            <span class="epg-prog-title">${prog.title}</span>
          </div>
        `;
      }
    } else {
      programmeBlocks = `
        <div class="epg-programme empty"
             data-channel-index="${globalIdx}"
             style="left: 0; width: ${gridWidth - 2}px">
          <span class="epg-prog-title">No programme data</span>
        </div>
      `;
    }

    return `
      <div class="epg-row" data-row-index="${globalIdx}">
        <div class="epg-channel-col">
          <span class="epg-ch-num">${globalIdx + 1}</span>
          <span class="epg-ch-name">${channel.name}</span>
        </div>
        <div class="epg-programmes" style="width: ${gridWidth}px; position: relative;">
          ${programmeBlocks}
        </div>
      </div>
    `;
  }

  private roundToSlot(date: Date): Date {
    const d = new Date(date);
    d.setMinutes(Math.floor(d.getMinutes() / 30) * 30, 0, 0);
    return new Date(d.getTime() - 30 * 60000);
  }

  private clampFocus(): void {
    const total = PlaylistService.channels.length;
    if (this.focusRow >= total) this.focusRow = total - 1;
    if (this.focusRow < 0) this.focusRow = 0;
  }

  private getFocusedProgramme(): HTMLElement | null {
    const row = this.container.querySelector<HTMLElement>(`[data-row-index="${this.focusRow}"]`);
    if (!row) return null;
    const progs = row.querySelectorAll<HTMLElement>('[data-channel-index]');
    if (!progs.length) return null;
    const idx = Math.min(this.focusProg, progs.length - 1);
    this.focusProg = idx;
    return progs[idx];
  }

  private updateFocus(): void {
    this.container.querySelectorAll('.epg-row.focused').forEach(el => el.classList.remove('focused'));
    this.container.querySelectorAll('.epg-programme.focused').forEach(el => el.classList.remove('focused'));

    const row = this.container.querySelector<HTMLElement>(`[data-row-index="${this.focusRow}"]`);
    if (row) row.classList.add('focused');

    const prog = this.getFocusedProgramme();
    if (prog) prog.classList.add('focused');

    this.updateInfoPanel();
  }

  private scrollToFocus(): void {
    const row = this.container.querySelector<HTMLElement>(`[data-row-index="${this.focusRow}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  private updateInfoPanel(): void {
    const panel = $('#epg-info', this.container);
    if (!panel) return;

    const focused = this.getFocusedProgramme();
    if (!focused) {
      panel.innerHTML = '';
      return;
    }

    const title = focused.dataset.progTitle || '';
    const desc = focused.dataset.progDesc || '';
    const time = focused.dataset.progTime || '';
    const icon = focused.dataset.progIcon || '';

    if (title) {
      panel.innerHTML = `
        <div class="epg-info-content">
          ${icon ? `<img class="epg-info-icon" src="${icon}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="epg-info-text">
            <div class="epg-info-title">${title}</div>
            <div class="epg-info-time">${time}</div>
            ${desc ? `<div class="epg-info-desc">${desc}</div>` : ''}
          </div>
        </div>
      `;
    } else {
      panel.innerHTML = '';
    }
  }

  private confirmSelect(): void {
    const prog = this.getFocusedProgramme();
    if (!prog) return;

    const channelIdx = parseInt(prog.dataset.channelIndex!, 10);
    const progStart = prog.dataset.progStart ? parseInt(prog.dataset.progStart, 10) : undefined;
    const progStop = prog.dataset.progStop ? parseInt(prog.dataset.progStop, 10) : undefined;
    const now = Math.floor(Date.now() / 1000);

    let catchup: CatchupInfo | undefined;
    if (progStart && progStart < now && progStop) {
      catchup = {
        start: progStart,
        end: progStop,
        title: prog.dataset.progTitle || '',
        description: prog.dataset.progDesc || '',
        icon: prog.dataset.progIcon || '',
      };
    }
    this.onChannelSelect(channelIdx, catchup);
  }

  handleAction(action: Action, _event?: NumberEvent): void {
    switch (action) {
      case 'up':
        if (this.focusRow > 0) {
          this.focusRow--;
          this.updateFocus();
          this.scrollToFocus();
        }
        break;

      case 'down': {
        const total = PlaylistService.channels.length;
        if (this.focusRow < total - 1) {
          this.focusRow++;
          this.updateFocus();
          this.scrollToFocus();
        }
        break;
      }

      case 'left':
        if (this.selectedDay < DAY_LABELS.length - 1) {
          this.selectDay(this.selectedDay + 1);
        }
        break;

      case 'right':
        if (this.selectedDay > 0) {
          this.selectDay(this.selectedDay - 1);
        }
        break;

      case 'channel_up':
        this.focusRow = Math.max(0, this.focusRow - 10);
        this.updateFocus();
        this.scrollToFocus();
        break;

      case 'channel_down': {
        const total = PlaylistService.channels.length;
        this.focusRow = Math.min(total - 1, this.focusRow + 10);
        this.updateFocus();
        this.scrollToFocus();
        break;
      }

      case 'select':
        this.confirmSelect();
        break;

      case 'green':
        this.selectDay(0);
        break;
    }
  }
}
