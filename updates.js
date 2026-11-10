function createUpdateController({ app, updater, onChange, platform = process.platform }) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  let state = { status: 'idle' };
  let busy = false;

  function setState(nextState) {
    state = nextState;
    onChange(state);
    return state;
  }

  updater.on('error', error => {
    console.error('Updater error:', error);
    if (state.status === 'installing') {
      busy = false;
      setState({ status: 'error', operation: 'install' });
    }
  });

  async function check() {
    if (busy || state.status === 'downloaded') return state;
    if (!app.isPackaged || platform !== 'win32') {
      return setState({ status: 'unavailable' });
    }

    busy = true;
    setState({ status: 'checking' });
    try {
      const result = await updater.checkForUpdates();
      if (!result) throw new Error('The updater is not active.');
      if (!result.isUpdateAvailable) return setState({ status: 'up-to-date' });
      if (!result.updateInfo || !result.updateInfo.version) {
        throw new Error('Update information does not include a version.');
      }
      return setState({ status: 'available', version: result.updateInfo.version });
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return setState({ status: 'error', operation: 'check' });
    } finally {
      busy = false;
    }
  }

  async function download() {
    if (busy || state.status !== 'available') return state;
    const version = state.version;
    busy = true;
    setState({ status: 'downloading', version });
    try {
      await updater.downloadUpdate();
      return setState({ status: 'downloaded', version });
    } catch (error) {
      console.error('Failed to download update:', error);
      return setState({ status: 'error', operation: 'download' });
    } finally {
      busy = false;
    }
  }

  function restart() {
    if (busy || state.status !== 'downloaded') return state;
    busy = true;
    setState({ status: 'installing', version: state.version });
    try {
      updater.quitAndInstall();
    } catch (error) {
      console.error('Failed to install update:', error);
      busy = false;
      return setState({ status: 'error', operation: 'install' });
    }
    return state;
  }

  return { check, download, restart, getState: () => state };
}

module.exports = { createUpdateController };
