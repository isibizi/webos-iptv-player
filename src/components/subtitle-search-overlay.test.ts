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
});
