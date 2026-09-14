require('./set-binary-mirror');
const { spawnSync } = require('child_process');
const path = require('path');

const desktopRoot = path.join(__dirname, '..');
const electronBuilderCli = path.join(
  desktopRoot,
  'node_modules',
  'electron-builder',
  'out',
  'cli',
  'cli.js'
);
const result = spawnSync(process.execPath, [electronBuilderCli, 'install-app-deps'], {
  stdio: 'inherit',
  cwd: desktopRoot,
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
