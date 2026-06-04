// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// toast.ts keeps a module-level singleton element. Reset the module before each
// test so state never leaks between cases.
let showToast: (message: string, duration?: number) => void;

describe('showToast', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.resetModules();
    vi.useFakeTimers();
    ({ showToast } = await import('./toast'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a visible toast element with the message', () => {
    showToast('Hello world');
    const toast = document.querySelector('.toast');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toBe('Hello world');
    expect(toast!.classList.contains('visible')).toBe(true);
  });

  it('reuses a single toast element across calls', () => {
    showToast('First');
    showToast('Second');
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    expect(document.querySelector('.toast')!.textContent).toBe('Second');
  });

  it('hides the toast after the given duration', () => {
    showToast('Bye', 1000);
    const toast = document.querySelector('.toast')!;
    expect(toast.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(toast.classList.contains('visible')).toBe(false);
  });
});
