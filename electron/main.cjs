/**
 * AI Agents — Electron シェル
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow;

async function createWindow() {
  process.env.AI_AGENTS_ELECTRON = '1';
  process.env.AI_AGENTS_DATA_DIR = app.getPath('userData');

  const { runServer } = require(path.join(__dirname, '..', 'server.js'));
  const port = await runServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'AI Agents',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    backgroundColor: '#060810',
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        return { action: 'allow' };
      }
    } catch (_) {}
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow).catch((e) => {
  console.error(e);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  try {
    const { server } = require(path.join(__dirname, '..', 'server.js'));
    server.close();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
