import { contextBridge, ipcRenderer } from 'electron'

export type PtySpawnOptions = {
  id: string
  shell: string
  args: string[]
  cwd?: string
  cols: number
  rows: number
}

export type PtySpawnResult = { ok: true; pid: number } | { ok: false; error: string }

export type PopOutTabPayload = {
  tabId: string
  agentId: string
  title: string
  shell: string
  args: string[]
  cwd?: string
}

const watcherAPI = {
  spawnPty: (options: PtySpawnOptions): Promise<PtySpawnResult> => ipcRenderer.invoke('pty:spawn', options),
  writePty: (id: string, data: string): void => ipcRenderer.send('pty:write', { id, data }),
  resizePty: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('pty:resize', { id, cols, rows }),
  killPty: (id: string): void => ipcRenderer.send('pty:kill', { id }),
  onPtyData: (callback: (id: string, data: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }): void =>
      callback(payload.id, payload.data)
    ipcRenderer.on('pty:data', listener)
    return () => ipcRenderer.removeListener('pty:data', listener)
  },
  onPtyExit: (callback: (id: string, exitCode: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; exitCode: number }): void =>
      callback(payload.id, payload.exitCode)
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.removeListener('pty:exit', listener)
  },
  popOutTab: (tab: PopOutTabPayload): Promise<void> => ipcRenderer.invoke('window:popOutTab', tab),
  newSessionId: (): Promise<string> => ipcRenderer.invoke('app:newSessionId')
}

export type WatcherAPI = typeof watcherAPI

contextBridge.exposeInMainWorld('watcher', watcherAPI)
