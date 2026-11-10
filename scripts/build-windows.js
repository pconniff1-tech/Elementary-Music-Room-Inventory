const { spawnSync } = require('child_process');

const builder = require.resolve('electron-builder/cli.js');

function runBuilder(args) {
  const result = spawnSync(process.execPath, [builder, ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error('Failed to run electron-builder:', result.error);
    return 1;
  }
  if (result.signal) {
    console.error(`electron-builder terminated by signal ${result.signal}`);
    return 1;
  }
  return result.status;
}

const buildStatus = runBuilder(['--win', ...process.argv.slice(2)]);
const restoreStatus = runBuilder(['install-app-deps', '--platform', process.platform, '--arch', process.arch]);
if (restoreStatus !== 0) {
  console.error('Failed to restore native dependencies for development.');
}
process.exitCode = buildStatus || restoreStatus;
