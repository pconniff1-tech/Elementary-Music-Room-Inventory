const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController } = require('../updates.js');

function setup(options = {}) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: '1.2.0' }
  });
  updater.downloadUpdate = async () => ['installer.exe'];
  updater.quitAndInstall = () => {};
  const states = [];
  const controller = createUpdateController({
    app: { isPackaged: options.isPackaged !== false },
    updater,
    platform: options.platform || 'win32',
    onChange: state => states.push(state)
  });
  return { updater, controller, states };
}

test('requires user approval before download and restart', async () => {
  const { updater, controller, states } = setup();
  let downloads = 0;
  let restarts = 0;
  updater.downloadUpdate = async () => { downloads++; return ['installer.exe']; };
  updater.quitAndInstall = () => { restarts++; };

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.deepEqual(await controller.check(), { status: 'available', version: '1.2.0' });
  assert.equal(downloads, 0);
  assert.equal(controller.restart().status, 'available');
  assert.deepEqual(await controller.download(), { status: 'downloaded', version: '1.2.0' });
  assert.equal(downloads, 1);
  assert.deepEqual(await controller.check(), { status: 'downloaded', version: '1.2.0' });
  assert.equal(restarts, 0);
  assert.deepEqual(controller.restart(), { status: 'installing', version: '1.2.0' });
  assert.equal(restarts, 1);
  assert.deepEqual(states.map(state => state.status), ['checking', 'available', 'downloading', 'downloaded', 'installing']);
});

test('reports up-to-date and unavailable cases', async () => {
  const current = setup();
  current.updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
  assert.equal((await current.controller.check()).status, 'up-to-date');
  for (const options of [{ isPackaged: false }, { platform: 'linux' }]) {
    const { updater, controller } = setup(options);
    updater.checkForUpdates = () => { throw new Error('must not check'); };
    assert.equal((await controller.check()).status, 'unavailable');
  }
});

test('surfaces check and download failures and permits retry', async () => {
  const { updater, controller } = setup();
  updater.checkForUpdates = async () => { throw new Error('offline'); };
  assert.deepEqual(await controller.check(), { status: 'error', operation: 'check' });
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '2.0.0' } });
  assert.equal((await controller.check()).status, 'available');
  updater.downloadUpdate = async () => { throw new Error('download failed'); };
  assert.deepEqual(await controller.download(), { status: 'error', operation: 'download' });
  assert.equal((await controller.check()).status, 'available');
  updater.downloadUpdate = async () => ['installer.exe'];
  assert.equal((await controller.download()).status, 'downloaded');
});

test('ignores repeated actions while a check or download is running', async () => {
  const { updater, controller } = setup();
  let finishCheck;
  let checks = 0;
  updater.checkForUpdates = () => {
    checks++;
    return new Promise(resolve => { finishCheck = resolve; });
  };
  const checking = controller.check();
  assert.equal((await controller.check()).status, 'checking');
  assert.equal((await controller.download()).status, 'checking');
  assert.equal(checks, 1);
  finishCheck({ isUpdateAvailable: true, updateInfo: { version: '3.0.0' } });
  await checking;

  let finishDownload;
  updater.downloadUpdate = () => new Promise(resolve => { finishDownload = resolve; });
  const downloading = controller.download();
  assert.equal((await controller.check()).status, 'downloading');
  assert.equal(controller.restart().status, 'downloading');
  finishDownload(['installer.exe']);
  await downloading;
  assert.equal(controller.getState().status, 'downloaded');
});

test('surfaces updater install errors and allows a new check', async () => {
  const { updater, controller } = setup();
  await controller.check();
  await controller.download();
  updater.quitAndInstall = () => updater.emit('error', new Error('installer failed'));
  assert.deepEqual(controller.restart(), { status: 'error', operation: 'install' });
  assert.equal((await controller.check()).status, 'available');
});

test('rejects missing update metadata', async () => {
  const { updater, controller } = setup();
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: {} });
  assert.deepEqual(await controller.check(), { status: 'error', operation: 'check' });
  updater.checkForUpdates = async () => null;
  assert.deepEqual(await controller.check(), { status: 'error', operation: 'check' });
});
