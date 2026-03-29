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
cpSync('assets/icon80.png', 'dist/icon.png');
cpSync('assets/icon130.png', 'dist/largeIcon.png');

// Main app bundle — excludes hls.js and mpegts.js (only needed on desktop)
const define = {
  '__APP_VERSION__': JSON.stringify(version),
  '__APP_ID__': JSON.stringify(appinfo.id),
};
await esbuild.build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: 'dist/js/app.js',
  format: 'iife',
  target: 'es2020',
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
  target: 'es2020',
  minify: true,
});

if (isWatch) {
  const ctx = await esbuild.context({
    entryPoints: ['src/app.ts'],
    bundle: true,
    outfile: 'dist/js/app.js',
    format: 'iife',
    target: 'es2020',
    minify: false,
    sourcemap: true,
    external: ['hls.js', 'mpegts.js'],
    define,
  });
  await ctx.watch();
  console.log('Watching for changes...');
}

console.log('Build complete.');
