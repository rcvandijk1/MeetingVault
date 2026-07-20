export type AgentDefinition = {
  id: string
  name: string
  shortLabel: string
  description: string
  accent: string
  /** Shell command used to launch the agent's CLI in the tab's terminal. `null` means the
   *  user must supply their own command (agents without an official CLI, e.g. web-chat products). */
  command: { shell: string; args: string[] } | null
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    shortLabel: 'Claude Code',
    description: "Anthropic's agentic coding CLI.",
    accent: '#d97757',
    command: { shell: 'claude', args: [] }
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    shortLabel: 'Codex',
    description: "OpenAI's agentic coding CLI.",
    accent: '#10a37f',
    command: { shell: 'codex', args: [] }
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    shortLabel: 'Copilot',
    description: "GitHub's Copilot agent, run from the terminal.",
    accent: '#8957e5',
    command: { shell: 'copilot', args: [] }
  },
  {
    id: 'claude-chat',
    name: 'Claude Chat',
    shortLabel: 'Claude',
    description: 'No official CLI — bring your own launch command (e.g. a browser-launch alias).',
    accent: '#c96442',
    command: null
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    shortLabel: 'ChatGPT',
    description: 'No official CLI — bring your own launch command.',
    accent: '#19c37d',
    command: null
  },
  {
    id: 'custom',
    name: 'Custom Command',
    shortLabel: 'Custom',
    description: 'Run any shell command in this tab.',
    accent: '#6e7681',
    command: null
  }
]

export function getAgent(id: string): AgentDefinition {
  return AGENTS.find((agent) => agent.id === id) ?? AGENTS[AGENTS.length - 1]
}

export function defaultShellForPlatform(): string {
  return navigator.platform.toLowerCase().includes('win') ? 'powershell.exe' : 'bash'
}
