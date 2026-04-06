const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { fork } = require('child_process')
const path = require('path')
const http = require('http')

let mainWindow
let serverProcess

function waitForServer(maxRetries = 30) {
  return new Promise((resolve, reject) => {
    let retries = 0
    const check = () => {
      const req = http.get('http://127.0.0.1:3000', (res) => {
        resolve()
      })
      req.on('error', () => {
        retries++
        if (retries >= maxRetries) {
          reject(new Error('Server did not start in time'))
        } else {
          setTimeout(check, 500)
        }
      })
      req.setTimeout(500, () => {
        req.destroy()
        retries++
        if (retries >= maxRetries) {
          reject(new Error('Server timeout'))
        } else {
          setTimeout(check, 500)
        }
      })
    }
    setTimeout(check, 1000)
  })
}

app.whenReady().then(async () => {
  // サーバーをforkで起動
  const serverPath = path.join(__dirname, '../server.js')
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, NODE_ENV: 'development' }
  })
  serverProcess.on('error', (err) => console.error('[Server] error:', err))
  serverProcess.on('exit', (code) => console.log('[Server] exited:', code))

  // ウィンドウを作成
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#0d0d1f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  // ロードエラーのログ
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[Window] load failed:', code, desc)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Window] loaded successfully')
    mainWindow.show()
  })

  // サーバー起動を待ってからロード
  try {
    await waitForServer()
    console.log('[Window] loading http://127.0.0.1:3000')
    await mainWindow.loadURL('http://127.0.0.1:3000')
  } catch (e) {
    console.error('[Window] server not ready, loading static file:', e.message)
    await mainWindow.loadFile(path.join(__dirname, '../public_new/index.html'))
    mainWindow.show()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    if (serverProcess) serverProcess.kill()
  })
})

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill()
})

ipcMain.handle('open-external', async (event, url) => {
  if (url && url.startsWith('http')) {
    await shell.openExternal(url)
  }
})
