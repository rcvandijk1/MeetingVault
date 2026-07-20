import { useState } from 'react'
import { AGENTS, defaultShellForPlatform, getAgent } from '../agents'
import type { Tab } from '../types'

type AgentPickerProps = {
  onCreate: (tab: Omit<Tab, 'id'>) => void
  onClose: () => void
}

export function AgentPicker({ onCreate, onClose }: AgentPickerProps): JSX.Element {
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null)
  const [customCommand, setCustomCommand] = useState('')

  function launch(agentId: string, command: { shell: string; args: string[] }): void {
    const agent = getAgent(agentId)
    onCreate({ agentId, title: agent.name, shell: command.shell, args: command.args })
    onClose()
  }

  function handleSelect(agentId: string): void {
    const agent = getAgent(agentId)
    if (agent.command) {
      launch(agentId, agent.command)
    } else {
      setPendingAgentId(agentId)
    }
  }

  function handleCustomSubmit(event: React.FormEvent): void {
    event.preventDefault()
    if (!pendingAgentId || !customCommand.trim()) return
    const [shell, ...args] = customCommand.trim().split(/\s+/)
    launch(pendingAgentId, { shell: shell ?? defaultShellForPlatform(), args })
  }

  return (
    <div className="agent-picker__backdrop" onClick={onClose}>
      <div className="agent-picker" onClick={(event) => event.stopPropagation()}>
        {!pendingAgentId ? (
          <>
            <div className="agent-picker__heading">Connect an agent</div>
            <ul className="agent-picker__list">
              {AGENTS.map((agent) => (
                <li key={agent.id}>
                  <button type="button" className="agent-picker__item" onClick={() => handleSelect(agent.id)}>
                    <span className="agent-picker__dot" style={{ background: agent.accent }} />
                    <span className="agent-picker__item-text">
                      <span className="agent-picker__item-name">{agent.name}</span>
                      <span className="agent-picker__item-desc">{agent.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <form className="agent-picker__custom" onSubmit={handleCustomSubmit}>
            <div className="agent-picker__heading">Launch command for {getAgent(pendingAgentId).name}</div>
            <input
              autoFocus
              type="text"
              value={customCommand}
              onChange={(event) => setCustomCommand(event.target.value)}
              placeholder="e.g. wsl chatgpt or npx open-chatgpt-cli"
            />
            <div className="agent-picker__custom-actions">
              <button type="button" onClick={() => setPendingAgentId(null)}>
                Back
              </button>
              <button type="submit" disabled={!customCommand.trim()}>
                Connect
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
