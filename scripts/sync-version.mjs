#!/usr/bin/env node

// Sync the version from package.json into appinfo.json. Runs from npm's
// `version` lifecycle hook so the version-bump commit/tag from
// `npm version <patch|minor|major>` includes the matching appinfo.json
// change. esbuild.config.mjs does the same sync at build time, so this
// script only matters for the commit-history alignment.
import { readFileSync, writeFileSync } from 'fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));

if (appinfo.version === version) {
  console.log('appinfo.json already at ' + version);
  process.exit(0);
}

appinfo.version = version;
writeFileSync('appinfo.json', JSON.stringify(appinfo, null, 2) + '\n');
console.log('Bumped appinfo.json to ' + version);
