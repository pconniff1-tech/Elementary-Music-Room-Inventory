const { app, BrowserWindow, ipcMain } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createUpdateController } = require('../updates.js');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const updater = new EventEmitter();
  let downloads = 0;
  let restarts = 0;
  let alertMessage;
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '2.0.0' } });
  updater.downloadUpdate = async () => { downloads++; return ['installer.exe']; };
  updater.quitAndInstall = () => { restarts++; };
  const updates = createUpdateController({
    app: { isPackaged: true },
    updater,
    platform: 'win32',
    onChange: state => window.webContents.send('update-state-changed', state)
  });

  ipcMain.handle('fetch-instruments-from-db', () => []);
  ipcMain.handle('fetch-categories-from-db', () => []);
  ipcMain.handle('get-app-version', () => '1.0.0');
  ipcMain.handle('show-alert-dialog', (_event, message) => { alertMessage = message; });
  ipcMain.handle('check-for-updates', () => updates.check());
  ipcMain.handle('download-update', () => updates.download());
  ipcMain.handle('restart-to-update', () => updates.restart());

  try {
    await window.loadFile(path.join(__dirname, '..', 'index.html'));
    await window.webContents.executeJavaScript(`(${async () => {
      const byId = id => document.getElementById(id);
      const waitFor = async predicate => {
        for (let i = 0; i < 100; i++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('Timed out waiting for UI state');
      };
      const check = (condition, message) => { if (!condition) throw new Error(message); };

      byId('settings-btn').click();
      check(!byId('settings-menu').hidden, 'Settings menu did not open');
      byId('open-category-settings-btn').click();
      check(byId('category-settings-modal').style.display === 'flex', 'Category modal did not open');
      check(byId('settings-menu').hidden, 'Settings menu did not close');
      byId('category-settings-close').click();

      byId('settings-btn').click();
      byId('about-btn').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      byId('settings-btn').click();
      byId('check-updates-btn').click();
      await waitFor(() => byId('update-action-btn').textContent === 'Update Now' && !byId('update-action-btn').hidden);
      check(byId('update-message').textContent.includes('2.0.0'), 'Available version not shown');
      check(byId('update-later-btn').textContent === 'Update Later', 'Update Later missing');
      byId('update-later-btn').click();
      check(!byId('update-dialog').open, 'Update dialog did not close');
      byId('settings-btn').click();
      byId('check-updates-btn').click();
      await waitFor(() => byId('update-action-btn').textContent === 'Update Now' && !byId('update-action-btn').hidden);
      byId('update-action-btn').click();
      await waitFor(() => byId('update-action-btn').textContent === 'Restart to Update');
      check(byId('update-message').textContent.includes('2.0.0'), 'Downloaded version not shown');
      byId('update-action-btn').click();
      await waitFor(() => byId('update-message').textContent.includes('restarting'));
    }})()`);
    assert.equal(alertMessage, 'Music Room Inventory\nVersion 1.0.0');
    assert.equal(downloads, 1);
    assert.equal(restarts, 1);
    console.log('Electron UI smoke test passed');
    app.exit(0);
  } catch (error) {
    console.error('Electron UI smoke test failed:', error);
    app.exit(1);
  }
}).catch(error => {
  console.error('Electron UI smoke test setup failed:', error);
  app.exit(1);
});
