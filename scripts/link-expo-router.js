#!/usr/bin/env node
/**
 * Heals an npm-workspace hoist quirk on Windows.
 *
 * `@expo/cli` lives in the workspace-root `node_modules/`, but its child package
 * `@expo/router-server` requires `expo-router/_ctx-shared`. Because `expo-router`
 * is a dep of `my-app` (not the root), npm sometimes places it only in
 * `my-app/node_modules/expo-router`, which the root-level CLI can't see.
 *
 * Fix: create a directory junction at `node_modules/expo-router` pointing into
 * `my-app/node_modules/expo-router`. Idempotent — bails out if the link or a
 * real directory already exists. Runs on `postinstall` so every `npm install`
 * self-heals.
 *
 * Junctions are Windows-only; on macOS / Linux npm normally hoists correctly,
 * so the script is a no-op there (we still create a symlink as a safety net).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const link = path.join(root, 'node_modules', 'expo-router');
const target = path.join(root, 'my-app', 'node_modules', 'expo-router');

function exit(msg) {
  console.log(`[link-expo-router] ${msg}`);
}

if (!fs.existsSync(target)) {
  exit(`target missing (${target}) — skipping. did npm install finish?`);
  process.exit(0);
}

try {
  const stat = fs.lstatSync(link);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    exit('already present — nothing to do.');
    process.exit(0);
  }
} catch {
  // doesn't exist — fall through to create
}

if (process.platform === 'win32') {
  const res = spawnSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'inherit' });
  process.exit(res.status ?? 0);
} else {
  fs.symlinkSync(target, link, 'dir');
  exit('symlink created.');
}
