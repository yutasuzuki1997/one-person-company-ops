/**
 * OneCompanyOps — Electron メインプロセス
 */
const { app, BrowserWindow, shell } = require('electron');
const { fork } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 3000;

let mainWindow;
let serverProcess;

/**
 * Express サーバーが応答するまでポーリングして待機する
 * @param {number} maxMs 最大待機時間（ミリ秒）
 */
function waitForServer(maxMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/settings/status`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > maxMs) {
          reject(new Error(`Server did not start within ${maxMs}ms`));
        } else {
          setTimeout(check, 300);
        }
      });
      req.end();
    };
    setTimeout(check, 200);
  });
}

async function createWindow() {
  // 開発時 / 本番時のパス切り替え
  const isDev = !app.isPackaged;
  const resourcesPath = isDev
    ? path.join(__dirname, '..')
    : process.resourcesPath;

  // userData: app-settings.json の保存先（本番）
  const userDataPath = app.getPath('userData');
  process.env.AI_AGENTS_DATA_DIR = userDataPath;
  process.env.AI_AGENTS_RESOURCES_PATH = resourcesPath;

  // server.js を別プロセスとして fork する
  const serverScript = isDev
    ? path.join(__dirname, '..', 'server.js')
    : path.join(resourcesPath, 'server.js');

  serverProcess = fork(serverScript, [], {
    env: {
      ...process.env,
      AI_AGENTS_ELECTRON: '0',
      PORT: String(PORT),
      RESOURCES_PATH: resourcesPath,
      USER_DATA_PATH: userDataPath,
    },
    silent: false,
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron] Server process error:', err);
  });
  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Server process exited with code ${code}`);
  });

  // Express が立ち上がるまで待機
  try {
    await waitForServer();
  } catch (e) {
    console.error('[Electron] Server startup timeout:', e.message);
    app.quit();
    return;
  }

  // app-settings.json の userName を取得してウィンドウタイトルに反映
  let appTitle = 'One-Company-Ops';
  try {
    const settingsData = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${PORT}/api/settings`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', () => resolve('{}'));
    });
    const settings = JSON.parse(settingsData);
    if (settings.userName && settings.userName.trim()) {
      appTitle = `One-Company-Ops [${settings.userName.trim()}]`;
    }
  } catch (_) {}

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    x: 100,
    y: 100,
    minWidth: 960,
    minHeight: 620,
    title: appTitle,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: true,
    backgroundColor: '#060810',
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  }

  mainWindow.focus();

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
  console.error('[Electron] Failed to create window:', e);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
