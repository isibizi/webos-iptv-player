// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { state, playlistMock, epgMock } = vi.hoisted(() => {
  const state = {
    channels: [] as any[],
    programmes: {} as Record<string, any[]>,
  };
  return {
    state,
    playlistMock: {
      get channels() { return state.channels; },
    },
    epgMock: {
      get programmes() { return state.programmes; },
      findChannelId: vi.fn((ch: any) => (state.programmes[ch.name] ? ch.name : null)),
    },
  };
});

vi.mock('../services/playlist-service', () => ({ PlaylistService: playlistMock }));
vi.mock('../services/epg-service', () => ({ EpgService: epgMock }));

const { reminderMock } = vi.hoisted(() => ({
  reminderMock: { has: vi.fn(() => false), add: vi.fn(), remove: vi.fn() },
}));
vi.mock('../services/reminder-service', () => ({ ReminderService: reminderMock }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));

import { EpgGrid } from './epg-grid';

const Y = 2024, M = 5, D = 15; // Sat Jun 15 2024, 12:00 local = "now"

function prog(h1: number, m1: number, h2: number, m2: number, title: string) {
  return {
    start: new Date(Y, M, D, h1, m1),
    stop: new Date(Y, M, D, h2, m2),
    title,
    description: `${title} description`,
    category: '',
    icon: '',
  };
}

let container: HTMLElement;
let onSelect: ReturnType<typeof vi.fn>;
let grid: EpgGrid;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Y, M, D, 12, 0, 0));
  Element.prototype.scrollIntoView = vi.fn();
  state.channels = [{ name: 'Chan A', url: 'http://host/a' }, { name: 'Chan B', url: 'http://host/b' }];
  state.programmes = {
    'Chan A': [
      prog(10, 0, 11, 0, 'Morning'),
      prog(11, 30, 12, 30, 'Noon Show'),
      prog(13, 0, 14, 0, 'Afternoon'),
      {
        start: new Date(Y, M, D + 1, 9, 0),
        stop: new Date(Y, M, D + 1, 10, 0),
        title: 'Tomorrow AM',
        description: '',
        category: '',
        icon: '',
      },
    ],
  };
  vi.clearAllMocks();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  onSelect = vi.fn();
  grid = new EpgGrid(container, onSelect);
});

afterEach(() => {
  vi.useRealTimers();
});

const channelItems = () => Array.from(container.querySelectorAll('.epg-channel-item'));
const dateItems = () => Array.from(container.querySelectorAll('.epg-date-item'));
const progItems = () => Array.from(container.querySelectorAll('.epg-programme-item'));

function clickData(attr: string, value: number): void {
  container.querySelector<HTMLElement>(`[${attr}="${value}"]`)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('EpgGrid.render', () => {
  beforeEach(() => grid.render());

  it('lists every channel', () => {
    expect(channelItems().map(el => el.querySelector('.epg-ch-name')!.textContent)).toEqual(['Chan A', 'Chan B']);
  });

  it('builds one date column per day spanned by program data', () => {
    expect(dateItems()).toHaveLength(2); // today + tomorrow
  });

  it('selects today by default and marks it', () => {
    const today = dateItems()[0];
    expect(today.classList.contains('today')).toBe(true);
    expect(today.classList.contains('selected')).toBe(true);
  });

  it("shows the selected channel's programs for today", () => {
    expect(progItems()).toHaveLength(3);
    expect(container.querySelector('.epg-page-info')!.textContent).toContain('Chan A');
    expect(container.querySelector('.epg-page-info')!.textContent).toContain('3 programs');
  });

  it('flags the currently airing program with a NOW badge', () => {
    const now = container.querySelector('.epg-programme-item.current');
    expect(now!.querySelector('.epg-now-badge')).not.toBeNull();
    expect(now!.querySelector('.epg-prog-title')!.textContent).toContain('Noon Show');
  });
});

describe('EpgGrid mouse interaction', () => {
  beforeEach(() => grid.render());

  it('selecting a different channel re-renders its (empty) guide', () => {
    clickData('data-channel-idx', 1);
    expect(channelItems()[1].classList.contains('selected')).toBe(true);
    expect(container.querySelector('.epg-no-data')!.textContent).toBe('No program data');
  });

  it('clicking the already-selected focused channel plays it', () => {
    clickData('data-channel-idx', 0); // focusCol is 'channels' and idx already selected
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('changing the day shows that day programs', () => {
    clickData('data-day-index', 1);
    expect(progItems()).toHaveLength(1);
    expect(progItems()[0].querySelector('.epg-prog-title')!.textContent).toContain('Tomorrow AM');
  });

  it('clicking a past program plays it with catch-up info', () => {
    clickData('data-prog-idx', 0); // Morning 10:00-11:00, before noon
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [idx, catchup] = onSelect.mock.calls[0];
    expect(idx).toBe(0);
    expect(catchup).toMatchObject({ title: 'Morning' });
    expect(catchup.start).toBeLessThan(catchup.end);
  });

  it('clicking a future program sets a reminder instead of tuning', () => {
    clickData('data-prog-idx', 2); // Afternoon 13:00-14:00, future vs noon
    expect(reminderMock.add).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('EpgGrid.handleAction', () => {
  beforeEach(() => grid.render());

  it('select on the channels column plays the channel', () => {
    grid.handleAction('select');
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('right moves focus to the programs column', () => {
    grid.handleAction('right');
    expect(container.querySelector('.epg-programmes-pane')!.classList.contains('pane-focused')).toBe(true);
  });

  it('down moves the channel selection', () => {
    grid.handleAction('down');
    expect(channelItems()[1].classList.contains('selected')).toBe(true);
  });

  it('green jumps the date selection back to today', () => {
    clickData('data-day-index', 1);
    expect(dateItems()[1].classList.contains('selected')).toBe(true);
    grid.handleAction('green');
    expect(dateItems()[0].classList.contains('selected')).toBe(true);
  });
});

describe('EpgGrid morph lifecycle', () => {
  it('preserves channel-item node identity across re-renders that only change focus', () => {
    grid.render();
    const beforeA = container.querySelector<HTMLElement>('[data-channel-idx="0"]')!;
    const beforeB = container.querySelector<HTMLElement>('[data-channel-idx="1"]')!;
    grid.handleAction('down');
    expect(container.querySelector('[data-channel-idx="0"]')).toBe(beforeA);
    expect(container.querySelector('[data-channel-idx="1"]')).toBe(beforeB);
    // The new selection is reflected via class only.
    expect(beforeB.classList.contains('selected')).toBe(true);
  });

  it('binds pane click handlers once (no accumulation across re-renders)', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const spy = vi.spyOn(c, 'addEventListener');
    const g = new EpgGrid(c, vi.fn());
    g.render();
    g.handleAction('down');
    g.handleAction('right');
    g.handleAction('down');
    const clicks = spy.mock.calls.filter(([t]) => t === 'click').length;
    const mouseovers = spy.mock.calls.filter(([t]) => t === 'mouseover').length;
    expect(clicks).toBe(1);
    expect(mouseovers).toBe(1);
  });
});

describe('EpgGrid reminders', () => {
  beforeEach(() => { reminderMock.has.mockReturnValue(false); grid.render(); });

  it('OK on a future program adds a reminder and does not tune', () => {
    grid.handleAction('right');            // focusCol → programmes (Morning, past)
    grid.handleAction('down'); grid.handleAction('down'); // → "Afternoon" (13:00, future)
    grid.handleAction('select');
    expect(reminderMock.add).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('OK on a future program that already has a reminder removes it', () => {
    reminderMock.has.mockReturnValue(true);
    grid.render();
    grid.handleAction('right');
    grid.handleAction('down'); grid.handleAction('down');
    grid.handleAction('select');
    expect(reminderMock.remove).toHaveBeenCalledTimes(1);
  });

  it('renders a dim (unset) bell on every future program as an affordance', () => {
    reminderMock.has.mockReturnValue(false);
    grid.render();
    expect(container.querySelector('#epg-programmes .epg-bell-glyph.unset')).not.toBeNull();
    expect(container.querySelector('#epg-programmes .epg-bell-glyph.set')).toBeNull();
  });

  it('renders an accent (set) bell on a reminded future program', () => {
    reminderMock.has.mockReturnValue(true);
    grid.render();
    expect(container.querySelector('#epg-programmes .epg-bell-glyph.set')).not.toBeNull();
  });

  it('OK on a live program still tunes (no reminder)', () => {
    grid.handleAction('right');
    grid.handleAction('down'); // "Noon Show" (11:30-12:30, live at 12:00)
    grid.handleAction('select');
    expect(onSelect).toHaveBeenCalled();
    expect(reminderMock.add).not.toHaveBeenCalled();
  });
});
