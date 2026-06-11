import * as esbuild from 'esbuild';
import { cpSync, readFileSync, writeFileSync } from 'fs';

const isWatch = process.argv.includes('--watch');
// Read version from package.json (single source of truth)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

// Sync version to appinfo.json
const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));
if (appinfo.version !== version) {
  appinfo.version = version;
  writeFileSync('appinfo.json', JSON.stringify(appinfo, null, 2) + '\n');
}

// Copy static assets to dist
cpSync('index.html', 'dist/index.html');
cpSync('appinfo.json', 'dist/appinfo.json');
cpSync('css', 'dist/css', { recursive: true });
cpSync('webOSjs/webOS.js', 'dist/webOSjs/webOS.js');
cpSync('assets/icon80.png', 'dist/icon.png');
cpSync('assets/icon130.png', 'dist/largeIcon.png');
cpSync('assets/group-icons', 'dist/assets/group-icons', { recursive: true });

// Main app bundle — excludes hls.js and mpegts.js (only needed on desktop).
const serviceId = JSON.parse(readFileSync('upload-service/src/services.json', 'utf8')).id;
const define = {
  '__APP_VERSION__': JSON.stringify(version),
  '__APP_ID__': JSON.stringify(appinfo.id),
  '__SERVICE_ID__': JSON.stringify(serviceId),
};
// Target Chromium 68 — the engine on webOS 5. This down-levels ES2020+
// syntax (`?.`, `??`, etc.) which would otherwise fail to parse on
// webOS 5/6 and leave the app stuck on the loading screen.
const TARGET = ['chrome68'];

await esbuild.build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: 'dist/js/app.js',
  format: 'iife',
  target: TARGET,
  minify: !isWatch,
  sourcemap: isWatch,
  external: ['hls.js', 'mpegts.js'],
  define,
});

// Desktop preview libs — separate bundle loaded only in preview
await esbuild.build({
  entryPoints: ['src/preview-libs.ts'],
  bundle: true,
  outfile: 'dist/js/preview-libs.js',
  format: 'iife',
  target: TARGET,
  minify: true,
});

if (isWatch) {
  const ctx = await esbuild.context({
    entryPoints: ['src/app.ts'],
    bundle: true,
    outfile: 'dist/js/app.js',
    format: 'iife',
    target: TARGET,
    minify: false,
    sourcemap: true,
    external: ['hls.js', 'mpegts.js'],
    define,
  });
  await ctx.watch();
  console.log('Watching for changes...');
}

console.log('Build complete.');
