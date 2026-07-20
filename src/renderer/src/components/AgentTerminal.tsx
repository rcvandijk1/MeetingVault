import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Tab } from '../types'

type AgentTerminalProps = {
  tab: Tab
  visible: boolean
}

export function AgentTerminal({ tab, visible }: AgentTerminalProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      convertEol: true,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      theme: {
        background: '#0d0f14',
        foreground: '#c9d1d9',
        cursor: '#6e56cf'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()
    terminalRef.current = terminal

    let disposed = false

    void window.watcher
      .spawnPty({
        id: tab.id,
        shell: tab.shell,
        args: tab.args,
        cwd: tab.cwd,
        cols: terminal.cols,
        rows: terminal.rows
      })
      .then((result) => {
        if (disposed) return
        if (!result.ok) {
          terminal.writeln(`\x1b[31mFailed to start "${tab.shell}": ${result.error}\x1b[0m`)
          terminal.writeln('\x1b[90mMake sure this agent\'s CLI is installed and on your PATH.\x1b[0m')
        }
      })

    const dataDisposable = window.watcher.onPtyData((id, data) => {
      if (id === tab.id) terminal.write(data)
    })
    const exitDisposable = window.watcher.onPtyExit((id, exitCode) => {
      if (id === tab.id) terminal.writeln(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m`)
    })

    const inputDisposable = terminal.onData((data) => window.watcher.writePty(tab.id, data))

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      window.watcher.resizePty(tab.id, terminal.cols, terminal.rows)
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      dataDisposable()
      exitDisposable()
      inputDisposable.dispose()
      resizeObserver.disconnect()
      window.watcher.killPty(tab.id)
      terminal.dispose()
      terminalRef.current = null
    }
    // Each tab owns exactly one pty session for its lifetime; re-running this on every
    // prop change would kill and respawn the agent process, so it intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        terminalRef.current?.focus()
      })
    }
  }, [visible])

  return <div ref={containerRef} className="agent-terminal" style={{ display: visible ? 'block' : 'none' }} />
}
