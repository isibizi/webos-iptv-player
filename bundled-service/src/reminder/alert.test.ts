import { describe, it, expect } from 'vitest';
import { buildAlertPayload } from './alert';

describe('buildAlertPayload', () => {
  it('builds an interactive createAlert payload with Watch now / Cancel', () => {
    const p = buildAlertPayload('Alpha', 'Bravo', 'ch-key-1', 'com.example.app');

    expect(p.sourceId).toBe('com.example.app');
    expect(p.title).toBe('Program reminder');
    expect(p.message).toContain('Bravo - Alpha');
    expect(p.message).toContain('is now live');
    expect(p.modal).toBe(true);
    expect(p.buttons).toHaveLength(2);

    const [watch, cancel] = p.buttons;
    expect(watch.label).toBe('Watch now');
    expect(watch.focus).toBe(true);
    expect(watch.onclick).toBe('luna://com.webos.applicationManager/launch');
    const params = watch.params as { id: string; params: { reminderChannelKey: string } };
    expect(params.id).toBe('com.example.app');
    expect(params.params.reminderChannelKey).toBe('ch-key-1');
    expect(cancel.label).toBe('Cancel');
    expect(cancel.onclick).toBeUndefined();
  });

  it('passes the title through verbatim in the message', () => {
    const p = buildAlertPayload('Bravo & "Co"', 'Charlie', 'ch2', 'com.example.app');
    expect(p.message).toContain('Bravo & "Co"');
  });
});
