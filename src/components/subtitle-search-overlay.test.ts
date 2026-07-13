// @vitest-environment jsdom
// src/components/subtitle-search-overlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SubtitleSearchOverlay } from './subtitle-search-overlay';
import type { OnlineSubtitleResult } from '../services/subtitle-search/types';

function res(over: Partial<OnlineSubtitleResult>): OnlineSubtitleResult {
  return { providerId: 'subdl', id: 'i', language: 'l1', releaseName: 'Rel', fileName: 'f.srt', format: 'srt', hearingImpaired: false, downloads: 0, ...over };
}

describe('SubtitleSearchOverlay', () => {
  it('lists results and fires onPick on select', () => {
    const container = document.createElement('div');
    const onPick = vi.fn();
    const overlay = new SubtitleSearchOverlay(container, onPick, vi.fn());
    overlay.open([res({ id: 'a', releaseName: 'A' }), res({ id: 'b', releaseName: 'B' })], '');
    expect(overlay.visible).toBe(true);
    expect(container.querySelectorAll('[data-result-index]').length).toBe(2);
    overlay.handleAction('down');
    overlay.handleAction('select');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('escapes untrusted release text', () => {
    const container = document.createElement('div');
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn());
    overlay.open([res({ releaseName: '<img src=x onerror=alert(1)>' })], '');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).toContain('&lt;img');
  });

  it('shows a status message', () => {
    const container = document.createElement('div');
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn());
    overlay.showStatus('No subtitles found');
    expect(container.textContent).toContain('No subtitles found');
  });

  it('labels an Assrt result as Assrt', () => {
    const container = document.createElement('div');
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn());
    overlay.open([res({ providerId: 'assrt', releaseName: 'Rel' })], '');
    expect(container.textContent).toContain('Assrt');
  });

  it('shows a thousands-formatted download count when known', () => {
    const container = document.createElement('div');
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn());
    overlay.open([res({ downloads: 12345 })], '');
    const count = container.querySelector('.subs-count');
    expect(count?.textContent?.trim()).toBe('12,345');
  });

  it('omits the download count when it is unknown (zero)', () => {
    const container = document.createElement('div');
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn());
    overlay.open([res({ downloads: 0 })], '');
    expect(container.querySelector('.subs-count')).toBeNull();
  });

  it('auto-dismisses a terminal status after a few seconds', () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      const onClose = vi.fn();
      const overlay = new SubtitleSearchOverlay(container, vi.fn(), onClose);
      overlay.showStatus('Download failed', true);
      expect(overlay.visible).toBe(true);
      vi.advanceTimersByTime(3000);
      expect(overlay.visible).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a transient status visible (no auto-close)', () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn());
      overlay.showStatus('Searching…');
      vi.advanceTimersByTime(10000);
      expect(overlay.visible).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefills the search box with the provided query', () => {
    const container = document.createElement('div');
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn(), vi.fn());
    overlay.open([res({})], '', 'Silent Harbor');
    const input = container.querySelector<HTMLInputElement>('.subs-search-input');
    expect(input?.value).toBe('Silent Harbor');
  });

  it('keeps the search box present (with its query) while showing a status', () => {
    const container = document.createElement('div');
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn(), vi.fn());
    overlay.setQuery('Silent Harbor');
    overlay.showStatus('No subtitles found');
    const input = container.querySelector<HTMLInputElement>('.subs-search-input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('Silent Harbor');
    expect(container.textContent).toContain('No subtitles found');
  });

  it('submits the trimmed query on Enter and ignores a blank query', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onSearch = vi.fn();
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn(), onSearch);
    overlay.open([res({})], '', 'Title');
    const input = container.querySelector<HTMLInputElement>('.subs-search-input')!;
    input.value = '  hello world  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSearch).toHaveBeenCalledWith('hello world');
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('ArrowDown in the search box moves focus into the results', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn(), vi.fn());
    overlay.open([res({ id: 'a' }), res({ id: 'b' })], '', 'Title');
    const input = container.querySelector<HTMLInputElement>('.subs-search-input')!;
    input.focus();
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).not.toBe(input);
    expect(container.querySelector('.subs-row.focused')?.getAttribute('data-result-index')).toBe('0');
    container.remove();
  });

  it('Up from the top result focuses the search box', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), vi.fn(), vi.fn());
    overlay.open([res({ id: 'a' }), res({ id: 'b' })], '', 'Title');
    overlay.handleAction('up');
    expect(document.activeElement).toBe(container.querySelector('.subs-search-input'));
    container.remove();
  });

  it('Back from the search box returns to the list; Back from the list closes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onClose = vi.fn();
    const overlay = new SubtitleSearchOverlay(container, vi.fn(), onClose, vi.fn());
    overlay.open([res({ id: 'a' })], '', 'Title');
    const input = container.querySelector<HTMLInputElement>('.subs-search-input')!;
    input.focus();
    overlay.handleAction('back');
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    overlay.handleAction('back');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(overlay.visible).toBe(false);
    container.remove();
  });
});
