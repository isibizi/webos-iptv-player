import compat from 'eslint-plugin-compat';
import tsParser from '@typescript-eslint/parser';
import { DENYLIST } from './scripts/compat-gate.mjs';

// webOS 5 ships Chromium 68. esbuild down-levels post-68 *syntax* (optional
// chaining, etc.) but it does NOT polyfill missing *APIs*, which would silently
// fail on a real webOS 5 TV. Two rules below close that gap, both keyed to the
// "browserslist" field in package.json (shared with the CSS gate):
//   - compat/compat        — flags missing global/static APIs (structuredClone, …)
//   - no-restricted-syntax — a denylist for the prototype methods compat can't see
//                            (it can't infer `arr.flat()` is Array.prototype.flat)
export default [
  {
    files: ['src/**/*.ts'],
    plugins: { compat },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'compat/compat': 'error',
      // eslint-plugin-compat catches global/static APIs (structuredClone,
      // Promise.allSettled, …) but NOT prototype *instance* methods, because it
      // can't infer that `arr.flat()` is Array.prototype.flat from the AST. Close
      // that blind spot with a name-based denylist of distinctive post-68 methods.
      // (If a custom object legitimately has one of these names, disable per-line.)
      'no-restricted-syntax': [
        'error',
        ...DENYLIST.filter((e) => e.kind === 'method').map((e) => ({
          selector: `CallExpression > MemberExpression[property.name='${e.name}']`,
          message: e.message,
        })),
      ],
    },
  },
  {
    // Tests run in Node under vitest, never on the webOS 5 WebView, so the
    // Chromium-68 compatibility gates don't apply to them.
    files: ['src/**/*.test.ts'],
    plugins: { compat },
    rules: {
      'compat/compat': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    // polyfills.ts intentionally installs APIs the compat gate bans; it is the
    // one place allowed to reference them.
    files: ['src/polyfills.ts'],
    plugins: { compat },
    rules: {
      'compat/compat': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
