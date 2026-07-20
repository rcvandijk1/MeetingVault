# MeetingVault

## Watcher

Watcher is a multi-window IDE shell for Windows 11. It's a single Electron
app where every tab is a real terminal wired up to an AI coding agent —
Claude Code, Codex CLI, GitHub Copilot CLI, or any other CLI-based agent —
so you can run several agents side by side and pop any tab out into its own
window when you want it on a separate monitor.

### Features

- **Tabs, each a live terminal.** Every tab spawns a real PTY (via
  `node-pty`) running the agent's CLI, not a mock or a webview.
- **Pop a tab into its own window.** Click the pop-out icon on a tab to
  detach it into a standalone window; the agent process keeps running.
- **Collapsible header.** The main window's header (with the Watcher mark)
  collapses to a thin strip to reclaim vertical space; the state persists
  across restarts.
- **Agent picker.** Built-in presets for Claude Code, Codex CLI, and GitHub
  Copilot CLI. Agents without an official CLI (Claude Chat, ChatGPT) or any
  other tool can be connected with a custom launch command.

### Prerequisites

- Windows 11 (the primary target platform; the app also runs on macOS/Linux
  since it's built on Electron).
- Node.js 20+.
- The CLI(s) for whichever agents you want to connect, available on `PATH`
  (e.g. `claude`, `codex`, `copilot`).

### Getting started

```bash
npm install
npm run dev
```

### Building a Windows installer

```bash
npm run dist:win
```

### Project layout

```
src/main       Electron main process — window management, PTY IPC handlers
src/preload    contextBridge API exposed to the renderer as window.watcher
src/renderer   React UI — header, tab bar, agent picker, xterm.js terminals
```

### Known limitations (v1)

- Tabs are not persisted across app restarts — reopen agents after
  relaunching.
- Agents without an official CLI (Claude Chat, ChatGPT) require you to
  supply your own launch command (e.g. a script that opens the chat in a
  browser).
