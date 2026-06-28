// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Channel } from '../types';
import { rankChannels } from './channel-search';

function ch(name: string, id = name): Channel {
  return { id, name, logo: '', group: '', url: '', extras: null,
    playlistIds: [], catchup: '', catchupSource: '', catchupDays: 0 };
}
const names = (cs: Channel[]) => cs.map(c => c.name);

describe('rankChannels', () => {
  it('returns [] for a blank/whitespace query', () => {
    expect(rankChannels([ch('Alpha')], '   ')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(names(rankChannels([ch('Alpha')], 'ALPHA'))).toEqual(['Alpha']);
  });

  it('excludes non-matching channels (result set == substring set)', () => {
    expect(names(rankChannels([ch('Alpha'), ch('Bravo')], 'alp'))).toEqual(['Alpha']);
  });

  it('orders exact > prefix > word-start > mid-word', () => {
    const cs = [ch('XAlpha'), ch('HD Alpha'), ch('Alpha HD'), ch('Alpha')];
    expect(names(rankChannels(cs, 'alpha'))).toEqual(['Alpha', 'Alpha HD', 'HD Alpha', 'XAlpha']);
  });

  it('breaks ties by earlier match position', () => {
    const cs = [ch('XXAlpha'), ch('XAlpha')]; // both mid-word; pos 2 vs pos 1
    expect(names(rankChannels(cs, 'alpha'))).toEqual(['XAlpha', 'XXAlpha']);
  });

  it('breaks remaining ties by shorter name', () => {
    const cs = [ch('Alpha International'), ch('Alpha HD')]; // both prefix, pos 0
    expect(names(rankChannels(cs, 'alpha'))).toEqual(['Alpha HD', 'Alpha International']);
  });

  it('breaks full ties by original order (deterministic on Chrome 68 unstable sort)', () => {
    const cs = [ch('Alpha', 'a'), ch('Alpha', 'b'), ch('Alpha', 'c')];
    expect(rankChannels(cs, 'alpha').map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats the query as one whole substring', () => {
    const cs = [ch('X a b Y'), ch('b a')];
    expect(names(rankChannels(cs, 'a b'))).toEqual(['X a b Y']);
  });
});
