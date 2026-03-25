'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
let version = pkg.version;

try {
  const tag = execSync('git describe --tags --abbrev=0', { stdio: ['pipe', 'pipe', 'pipe'] })
    .toString()
    .trim();
  const parsed = tag.replace(/^v/, '');
  if (/^\d+\.\d+/.test(parsed)) {
    version = parsed;
  } else {
    console.warn(`[set-version] Tag "${tag}" is not semver-shaped, keeping ${version}`);
  }
} catch {
  console.warn(`[set-version] No git tags found, keeping version ${version}`);
}

pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[set-version] package.json version → ${version}`);
