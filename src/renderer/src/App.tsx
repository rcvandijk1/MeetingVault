import { useMemo, useState } from 'react'
import { CollapsibleHeader } from './components/CollapsibleHeader'
import { TabBar } from './components/TabBar'
import { AgentTerminal } from './components/AgentTerminal'
import type { Tab } from './types'

function readStandaloneTab(): Tab | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('tab')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      tabId: string
      agentId: string
      title: string
      shell: string
      args: string[]
      cwd?: string
    }
    return {
      id: parsed.tabId,
      agentId: parsed.agentId,
      title: parsed.title,
      shell: parsed.shell,
      args: parsed.args,
      cwd: parsed.cwd
    }
  } catch {
    return null
  }
}

function StandaloneTabWindow({ tab }: { tab: Tab }): JSX.Element {
  return (
    <div className="watcher-app watcher-app--standalone">
      <div className="watcher-header__drag standalone-drag" />
      <AgentTerminal tab={tab} visible />
    </div>
  )
}

let tabCounter = 0
function nextTabId(): string {
  tabCounter += 1
  return `tab-${Date.now()}-${tabCounter}`
}

function MainWindow(): JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  function handleCreate(tab: Omit<Tab, 'id'>): void {
    const id = nextTabId()
    const created: Tab = { id, ...tab }
    setTabs((current) => [...current, created])
    setActiveTabId(id)
  }

  function handleClose(id: string): void {
    setTabs((current) => current.filter((tab) => tab.id !== id))
    setActiveTabId((current) => {
      if (current !== id) return current
      const remaining = tabs.filter((tab) => tab.id !== id)
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null
    })
  }

  function handlePopOut(id: string): void {
    const tab = tabs.find((candidate) => candidate.id === id)
    if (!tab) return
    void window.watcher.popOutTab({
      tabId: `tab-${Date.now()}-popout`,
      agentId: tab.agentId,
      title: tab.title,
      shell: tab.shell,
      args: tab.args,
      cwd: tab.cwd
    })
    handleClose(id)
  }

  const emptyState = useMemo(() => tabs.length === 0, [tabs.length])

  return (
    <div className="watcher-app">
      <CollapsibleHeader tabCount={tabs.length} />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={handleClose}
        onCreate={handleCreate}
        onPopOut={handlePopOut}
      />
      <div className="watcher-workspace">
        {emptyState && (
          <div className="watcher-empty-state">
            <p>No agents connected yet.</p>
            <p className="watcher-empty-state__hint">Use the + button above to connect Claude Code, Codex, Copilot, or any CLI agent.</p>
          </div>
        )}
        {tabs.map((tab) => (
          <AgentTerminal key={tab.id} tab={tab} visible={tab.id === activeTabId} />
        ))}
      </div>
    </div>
  )
}

export function App(): JSX.Element {
  const standaloneTab = useMemo(readStandaloneTab, [])
  return standaloneTab ? <StandaloneTabWindow tab={standaloneTab} /> : <MainWindow />
}
