import compat from 'eslint-plugin-compat';
import tsParser from '@typescript-eslint/parser';

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
        { selector: "CallExpression > MemberExpression[property.name='flat']", message: 'Array.prototype.flat is Chrome 69+ — not on webOS 5 (Chromium 68). Use reduce/concat.' },
        { selector: "CallExpression > MemberExpression[property.name='flatMap']", message: 'Array.prototype.flatMap is Chrome 69+ — not on webOS 5 (Chromium 68).' },
        { selector: "CallExpression > MemberExpression[property.name='at']", message: 'Array/String.prototype.at is Chrome 92+ — not on webOS 5 (Chromium 68). Use [index] / length-1.' },
        { selector: "CallExpression > MemberExpression[property.name='replaceAll']", message: 'String.prototype.replaceAll is Chrome 85+ — not on webOS 5 (Chromium 68). Use .replace(/x/g, …).' },
        { selector: "CallExpression > MemberExpression[property.name='replaceChildren']", message: 'Element.replaceChildren is Chrome 86+ — not on webOS 5 (Chromium 68).' },
        { selector: "CallExpression > MemberExpression[property.name='findLast']", message: 'Array.prototype.findLast is Chrome 97+ — not on webOS 5 (Chromium 68). Reverse-iterate or use a loop.' },
        { selector: "CallExpression > MemberExpression[property.name='findLastIndex']", message: 'Array.prototype.findLastIndex is Chrome 97+ — not on webOS 5 (Chromium 68).' },
        { selector: "CallExpression > MemberExpression[property.name='toSorted']", message: 'Array.prototype.toSorted is Chrome 110+ — not on webOS 5 (Chromium 68). Use [...arr].sort().' },
        { selector: "CallExpression > MemberExpression[property.name='toReversed']", message: 'Array.prototype.toReversed is Chrome 110+ — not on webOS 5 (Chromium 68). Use [...arr].reverse().' },
        { selector: "CallExpression > MemberExpression[property.name='toSpliced']", message: 'Array.prototype.toSpliced is Chrome 110+ — not on webOS 5 (Chromium 68).' },
        { selector: "CallExpression > MemberExpression[property.name='isWellFormed']", message: 'String.prototype.isWellFormed is Chrome 111+ — not on webOS 5 (Chromium 68).' },
        { selector: "CallExpression > MemberExpression[property.name='toWellFormed']", message: 'String.prototype.toWellFormed is Chrome 111+ — not on webOS 5 (Chromium 68).' },
      ],
    },
  },
];
