import { useState } from 'react'
import { getAgent } from '../agents'
import type { Tab } from '../types'
import { AgentPicker } from './AgentPicker'

type TabBarProps = {
  tabs: Tab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCreate: (tab: Omit<Tab, 'id'>) => void
  onPopOut: (id: string) => void
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onCreate, onPopOut }: TabBarProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs">
        {tabs.map((tab) => {
          const agent = getAgent(tab.agentId)
          const active = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={`tab-bar__tab ${active ? 'tab-bar__tab--active' : ''}`}
              onClick={() => onSelect(tab.id)}
              style={{ borderTopColor: active ? agent.accent : 'transparent' }}
            >
              <span className="tab-bar__dot" style={{ background: agent.accent }} />
              <span className="tab-bar__title">{tab.title}</span>
              <button
                type="button"
                className="tab-bar__icon-btn"
                title="Open in new window"
                onClick={(event) => {
                  event.stopPropagation()
                  onPopOut(tab.id)
                }}
              >
                ⧉
              </button>
              <button
                type="button"
                className="tab-bar__icon-btn"
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button type="button" className="tab-bar__add" onClick={() => setPickerOpen(true)} title="Connect an agent">
        +
      </button>
      {pickerOpen && <AgentPicker onCreate={onCreate} onClose={() => setPickerOpen(false)} />}
    </div>
  )
}
