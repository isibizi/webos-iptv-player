// Runtime polyfills for APIs missing on webOS 5 (Chromium 68) that arrive via
// bundled dependencies. Imported first in src/app.ts so they apply before any
// dependency code runs. Each install is guarded (only patches when absent).
//
// assjs's animation renderer uses two post-68 APIs unguarded, both of which
// throw on webOS 5:
//   - Array.prototype.flatMap (Chrome 69+) — see flatMapPolyfill
//   - Object.fromEntries      (Chrome 73+) — see fromEntriesPolyfill
// Both are implemented without calling the API they replace.
export function flatMapPolyfill(
  this: unknown[],
  callback: (value: unknown, index: number, array: unknown[]) => unknown,
  thisArg?: unknown,
): unknown[] {
  if (this == null) throw new TypeError('flatMap called on null or undefined');
  if (typeof callback !== 'function') throw new TypeError(String(callback) + ' is not a function');
  const arr = Object(this);
  const len = arr.length >>> 0;
  const result: unknown[] = [];
  for (let i = 0; i < len; i++) {
    if (i in arr) {
      const mapped = callback.call(thisArg, arr[i], i, arr);
      if (Array.isArray(mapped)) {
        for (let j = 0; j < mapped.length; j++) {
          if (j in mapped) result.push(mapped[j]);
        }
      } else {
        result.push(mapped);
      }
    }
  }
  return result;
}

if (!(Array.prototype as any).flatMap) {
  (Array.prototype as unknown as { flatMap: typeof flatMapPolyfill }).flatMap = flatMapPolyfill;
}

export function fromEntriesPolyfill(
  entries: Iterable<readonly [PropertyKey, unknown]>,
): Record<PropertyKey, unknown> {
  if (entries == null) throw new TypeError('Object.fromEntries called on non-object');
  const obj: Record<PropertyKey, unknown> = {};
  for (const pair of entries) {
    obj[pair[0]] = pair[1];
  }
  return obj;
}

if (!(Object as any).fromEntries) {
  (Object as unknown as { fromEntries: typeof fromEntriesPolyfill }).fromEntries = fromEntriesPolyfill;
}
