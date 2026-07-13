import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { getCachedSubtitle, setCachedSubtitle } from './idb-cache';

describe('idb-cache subtitle cache', () => {
  it('round-trips a cached subtitle', async () => {
    await setCachedSubtitle('subdl:1', 'WEBVTT\n\nhi');
    expect(await getCachedSubtitle('subdl:1')).toContain('hi');
    expect(await getCachedSubtitle('missing')).toBeNull();
  });
});
