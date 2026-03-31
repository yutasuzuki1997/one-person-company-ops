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
        res.resume(); // レスポンスボディを消費してソケットを解放
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
    setTimeout(check, 200); // 起動直後の短い待機
  });
}

async function createWindow() {
  process.env.AI_AGENTS_DATA_DIR = app.getPath('userData');

  // server.js を別プロセスとして fork する
  serverProcess = fork(path.join(__dirname, '..', 'server.js'), [], {
    env: {
      ...process.env,
      AI_AGENTS_ELECTRON: '0', // ランダムポートを使わず固定ポートで起動
      PORT: String(PORT),
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
    minWidth: 960,
    minHeight: 620,
    title: appTitle,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    backgroundColor: '#060810',
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // 開発時: Vite dev server（HMR 付き）をロード
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    // 本番時: Express が public_new/index.html を配信する
    // ビルド成果物: path.join(__dirname, '../public_new/index.html')
    await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  }

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
  console.error('[Electron] Failed to create window:', e);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// アプリ終了時にサーバープロセスも確実に終了させる
app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
