import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { registerIpc } from './registerIpc';

const isDev = process.env.NODE_ENV === 'development';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Default sandbox blocks `require()` of local modules in preload; keep isolation without sandbox.
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5174');
    win.webContents.openDevTools(); // ignore DevTools CDP noise (e.g. Autofill.* not implemented in Electron)
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();
  const browserService = new ElectronBrowserService(win, app.getPath('userData'));
  void browserService.init();
  registerIpc(browserService);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
