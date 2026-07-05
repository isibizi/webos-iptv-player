// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReminderPrompt } from './reminder-prompt';

let prompt: ReminderPrompt;
beforeEach(() => { document.body.innerHTML = ''; prompt = new ReminderPrompt(); });

const buttons = () => Array.from(document.querySelectorAll('.reminder-btn'));

describe('ReminderPrompt', () => {
  it('renders the title and OK/Cancel and starts focused on OK', () => {
    prompt.show('Alpha', { onConfirm: vi.fn(), onCancel: vi.fn() });
    expect(prompt.visible).toBe(true);
    expect(document.querySelector('.reminder-message')!.textContent).toContain('Alpha');
    expect(buttons().map(b => b.textContent)).toEqual(['OK', 'Cancel']);
    expect(document.querySelector('.reminder-btn.focused')!.textContent).toBe('OK');
  });

  it('select on OK confirms and hides', () => {
    const onConfirm = vi.fn();
    prompt.show('Alpha', { onConfirm, onCancel: vi.fn() });
    prompt.handleAction('select');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(prompt.visible).toBe(false);
  });

  it('right then select cancels; back cancels', () => {
    const onCancel = vi.fn();
    prompt.show('Alpha', { onConfirm: vi.fn(), onCancel });
    prompt.handleAction('right');
    expect(document.querySelector('.reminder-btn.focused')!.textContent).toBe('Cancel');
    prompt.handleAction('select');
    expect(onCancel).toHaveBeenCalledTimes(1);

    const onCancel2 = vi.fn();
    prompt.show('Beta', { onConfirm: vi.fn(), onCancel: onCancel2 });
    prompt.handleAction('back');
    expect(onCancel2).toHaveBeenCalledTimes(1);
  });

  it('escapes the title (no raw HTML injection)', () => {
    prompt.show('<img src=x>', { onConfirm: vi.fn(), onCancel: vi.fn() });
    expect(document.querySelector('.reminder-message img')).toBeNull();
  });
});
