/**
 * fix-wincosign.js  —  run once after a failed build
 *
 * electron-builder needs winCodeSign-2.6.0 in its cache but can't finish
 * extracting it because Windows (without Developer Mode) won't create the
 * two macOS symlinks inside the archive. This script:
 *   1. Finds the most recent partial extraction in the cache folder
 *   2. Copies it to the expected "winCodeSign-2.6.0" directory name
 *   3. Creates empty placeholder files for the two missing macOS symlinks
 *
 * After this runs once, electron-builder finds the cache and never
 * downloads winCodeSign again.
 *
 * Usage:  node scripts/fix-wincosign.js
 */

const fs   = require('fs');
const path = require('path');

const CACHE_BASE  = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign');
const TARGET_NAME = 'winCodeSign-2.6.0';
const TARGET_DIR  = path.join(CACHE_BASE, TARGET_NAME);

// ── Already done? ─────────────────────────────────────────────────────────────
if (fs.existsSync(TARGET_DIR)) {
  const contents = fs.readdirSync(TARGET_DIR);
  if (contents.length > 0) {
    console.log('✓ winCodeSign already cached at:');
    console.log('  ' + TARGET_DIR);
    console.log('\nYou can run  npm run build  now.');
    process.exit(0);
  }
}

// ── Find the most recent partial extraction ────────────────────────────────────
if (!fs.existsSync(CACHE_BASE)) {
  console.error('✗ Cache directory not found:');
  console.error('  ' + CACHE_BASE);
  console.error('\nRun  npm run build  once (let it fail), then re-run this script.');
  process.exit(1);
}

const candidates = fs.readdirSync(CACHE_BASE, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== TARGET_NAME)
  .map(e => {
    const full = path.join(CACHE_BASE, e.name);
    const stat = fs.statSync(full);
    const files = countFiles(full);
    return { name: e.name, full, mtime: stat.mtimeMs, files };
  })
  .filter(e => e.files > 0)
  .sort((a, b) => b.mtime - a.mtime);

if (!candidates.length) {
  console.error('✗ No partial extraction found in:');
  console.error('  ' + CACHE_BASE);
  console.error('\nRun  npm run build  once (let it fail), then re-run this script.');
  process.exit(1);
}

const best = candidates[0];
console.log(`Found partial extraction: ${best.name}  (${best.files} files)`);
console.log(`Copying to: ${TARGET_DIR} ...`);

// ── Recursive copy (skip symlinks — that's the whole point) ───────────────────
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if      (entry.isDirectory()) copyDir(srcPath, destPath);
    else if (entry.isFile())      fs.copyFileSync(srcPath, destPath);
    // symlinks: skip — they're the macOS dylibs that couldn't be created
  }
}

function countFiles(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if      (e.isFile())      n++;
      else if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    }
  } catch (_) {}
  return n;
}

copyDir(best.full, TARGET_DIR);

// ── Create placeholder files for the two missing macOS symlinks ───────────────
// These are only used on macOS cross-compilation. On a Windows→Windows build
// they are never read; their absence caused the 7-Zip exit code 2 failure.
const missingSymlinks = [
  path.join(TARGET_DIR, 'darwin', '10.12', 'lib', 'libcrypto.dylib'),
  path.join(TARGET_DIR, 'darwin', '10.12', 'lib', 'libssl.dylib'),
];

for (const p of missingSymlinks) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');  // empty placeholder — content is never read
    console.log(`  Created placeholder: ${path.relative(TARGET_DIR, p)}`);
  }
}

const finalCount = countFiles(TARGET_DIR);
console.log(`\n✓ winCodeSign cache seeded (${finalCount} files)`);
console.log('\nRun  npm run build  now — it will skip the download entirely.');