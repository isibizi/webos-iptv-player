import { readFileSync } from 'fs';
import { defineConfig } from 'vitest/config';

const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));

// Unit/integration tests run under Vitest. The app bundle normally has these
// build-time constants injected by esbuild (see esbuild.config.mjs); Vitest has
// no esbuild define step, so we replace them here too.
export default defineConfig({
  define: {
    __APP_ID__: JSON.stringify(appinfo.id),
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    // Default to Node. DOM-dependent tests opt in per-file with:
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep coverage output under the shared test-output/ folder.
    coverage: {
      reportsDirectory: 'test-output/coverage',
    },
  },
});
