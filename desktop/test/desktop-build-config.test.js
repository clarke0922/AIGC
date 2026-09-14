const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.join(__dirname, '..');
const repoRoot = path.join(desktopRoot, '..');

test('npmrc files do not configure the unsupported better-sqlite3 mirror key', () => {
  for (const relativePath of ['desktop/.npmrc', 'backend-node/.npmrc']) {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(content, /better[_-]sqlite3[_-]binary[_-]host[_-]mirror/i);
  }
});

test('desktop dependency rebuild invokes electron-builder directly with Node', () => {
  const content = fs.readFileSync(path.join(desktopRoot, 'scripts', 'install-app-deps.js'), 'utf8');
  assert.match(content, /electron-builder.*out.*cli.*cli\.js/s);
  assert.doesNotMatch(content, /npx(\.cmd)?/i);
  assert.doesNotMatch(content, /npm(\.cmd)?/i);
});
