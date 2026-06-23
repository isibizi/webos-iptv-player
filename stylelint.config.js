// webOS 5 ships Chromium 68. This gate fails the build when CSS uses a feature
// that engine lacks. The target is read from the "browserslist" field in
// package.json (Chromium 68), shared with the JS gate (eslint-plugin-compat).
//
// `ignore` lists caniuse feature names we knowingly accept — either because we
// provide a build-time fallback (e.g. the generated flex-gap margins), or because
// they degrade gracefully on Chromium 68.
module.exports = {
  plugins: ['stylelint-no-unsupported-browser-features'],
  rules: {
    'plugin/no-unsupported-browser-features': [
      true,
      {
        severity: 'error',
        ignore: [
          // Flex gap gets a margin-based fallback generated at build time and
          // appended to legacy-webos.css (see esbuild.config.mjs).
          'flexbox-gap',
          // Only hidden/auto/scroll/visible + text-overflow:ellipsis are used —
          // all fully supported on 68. doiuse flags the newer values (overflow:clip,
          // two-value syntax) that we never use.
          'css-overflow',
          // position:sticky works since Chrome 56; the "partial" flag is for table
          // (<th>/<thead>) sticky edge cases, which we don't use.
          'css-sticky',
          // Degrades gracefully: Chromium 68 ignores the query, so animations simply
          // always run (no reduced-motion opt-out on webOS 5).
          'prefers-reduced-motion',
          // Degrades gracefully: every backdrop-filter has a >=75% opaque background
          // fallback, so panels lose only the frosted blur on webOS 5, not legibility.
          'css-backdrop-filter',
        ],
      },
    ],
  },
};
