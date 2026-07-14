import { describe, it, expect } from 'vitest';
import { flatMapPolyfill, fromEntriesPolyfill } from './polyfills';

describe('flatMapPolyfill', () => {
  it('maps and flattens one level', () => {
    const out = flatMapPolyfill.call([1, 2, 3], (x) => [x, (x as number) * 2]);
    expect(out).toEqual([1, 2, 2, 4, 3, 6]);
  });

  it('keeps non-array return values as single elements', () => {
    const out = flatMapPolyfill.call([1, 2], (x) => x);
    expect(out).toEqual([1, 2]);
  });

  it('flattens only one level (nested arrays are preserved)', () => {
    const out = flatMapPolyfill.call([1], () => [[9]]);
    expect(out).toEqual([[9]]);
  });

  it('skips holes in a sparse mapped array (matches native FlattenIntoArray)', () => {
    const sparse: number[] = [];
    sparse[0] = 5;
    sparse[2] = 9; // index 1 is a hole
    const out = flatMapPolyfill.call([1], () => sparse);
    expect(out).toEqual([5, 9]);
  });

  it('passes index and array to the callback', () => {
    const seen: number[] = [];
    flatMapPolyfill.call(['a', 'b'], (_v, i) => {
      seen.push(i as number);
      return [];
    });
    expect(seen).toEqual([0, 1]);
  });

  it('honours thisArg', () => {
    const ctx = { mult: 10 };
    const out = flatMapPolyfill.call(
      [1, 2],
      function (this: typeof ctx, x) {
        return [(x as number) * this.mult];
      },
      ctx,
    );
    expect(out).toEqual([10, 20]);
  });
});

describe('fromEntriesPolyfill', () => {
  it('builds an object from an array of key/value pairs', () => {
    const out = fromEntriesPolyfill([
      ['a', 1],
      ['b', 2],
    ]);
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it('accepts any iterable of pairs (e.g. a Map)', () => {
    const out = fromEntriesPolyfill(
      new Map<string, number>([
        ['x', 9],
        ['y', 8],
      ]),
    );
    expect(out).toEqual({ x: 9, y: 8 });
  });

  it('lets a later duplicate key win', () => {
    const out = fromEntriesPolyfill([
      ['k', 1],
      ['k', 2],
    ]);
    expect(out).toEqual({ k: 2 });
  });
});
