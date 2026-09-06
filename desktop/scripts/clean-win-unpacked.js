const fs = require('fs');
const path = require('path');
const release = path.resolve(__dirname, '..', 'release');
const target = path.resolve(release, 'win-unpacked');
if (target !== path.join(release, 'win-unpacked')) throw new Error('Invalid build cleanup path');
// Only our build output is removed. Never stop other Electron apps or workspaces.
if (fs.existsSync(target)) {
  if (!fs.realpathSync(target).startsWith(fs.realpathSync(release) + path.sep)) throw new Error('Build output escapes release directory');
  fs.rmSync(target, { recursive: true });
}
console.log('Build directory ready');
