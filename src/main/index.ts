import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// node-pty ships native bindings per-platform. Loading it must never crash the
// app on a platform/architecture where a prebuilt binary isn't available —
// spawn requests simply fail gracefully and the terminal pane shows why.
let pty: typeof import('node-pty') | null = null
try {
  pty = require('node-pty')
} catch (error) {
  console.error('[watcher] node-pty failed to load; terminal panes will be unavailable.', error)
}

type PtySession = {
  proc: import('node-pty').IPty
  windowId: number
}

const sessions = new Map<string, PtySession>()

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0f14',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0f14',
      symbolColor: '#c9d1d9',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  return win
}

function createTabWindow(query: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 480,
    minHeight: 320,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0f14',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0f14',
      symbolColor: '#c9d1d9',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    for (const [id, session] of sessions) {
      if (session.windowId === win.id) {
        session.proc.kill()
        sessions.delete(id)
      }
    }
  })

  loadRenderer(win, query)
  return win
}

function loadRenderer(win: BrowserWindow, query = ''): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    win.loadURL(query ? `${devServerUrl}?${query}` : devServerUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), query ? { search: query } : undefined)
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('pty:spawn', (event, options: {
    id: string
    shell: string
    args: string[]
    cwd?: string
    cols: number
    rows: number
  }) => {
    if (!pty) {
      return { ok: false as const, error: 'node-pty is not available on this platform/build.' }
    }
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const proc = pty.spawn(options.shell, options.args, {
        name: 'xterm-color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd || app.getPath('home'),
        env: process.env as Record<string, string>
      })

      sessions.set(options.id, { proc, windowId: win?.id ?? -1 })

      proc.onData((data) => {
        event.sender.send('pty:data', { id: options.id, data })
      })
      proc.onExit(({ exitCode }) => {
        event.sender.send('pty:exit', { id: options.id, exitCode })
        sessions.delete(options.id)
      })

      return { ok: true as const, pid: proc.pid }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.on('pty:write', (_event, { id, data }: { id: string; data: string }) => {
    sessions.get(id)?.proc.write(data)
  })

  ipcMain.on('pty:resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    sessions.get(id)?.proc.resize(cols, rows)
  })

  ipcMain.on('pty:kill', (_event, { id }: { id: string }) => {
    sessions.get(id)?.proc.kill()
    sessions.delete(id)
  })

  ipcMain.handle('window:popOutTab', (_event, tab: unknown) => {
    const query = new URLSearchParams({ tab: JSON.stringify(tab) }).toString()
    createTabWindow(query)
  })

  ipcMain.handle('app:newSessionId', () => randomUUID())
}

app.whenReady().then(() => {
  registerIpcHandlers()
  const win = createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })

  void win
})

app.on('window-all-closed', () => {
  for (const session of sessions.values()) session.proc.kill()
  sessions.clear()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  for (const session of sessions.values()) session.proc.kill()
  sessions.clear()
})
