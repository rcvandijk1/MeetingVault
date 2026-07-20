import { Component, type ReactNode } from 'react'

type TerminalErrorBoundaryProps = {
  agentName: string
  children: ReactNode
}

type TerminalErrorBoundaryState = {
  error: Error | null
}

export class TerminalErrorBoundary extends Component<TerminalErrorBoundaryProps, TerminalErrorBoundaryState> {
  state: TerminalErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): TerminalErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(`[watcher] tab "${this.props.agentName}" crashed:`, error)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="agent-terminal agent-terminal--error">
          <p>{this.props.agentName} failed to start.</p>
          <p className="agent-terminal--error__detail">{this.state.error.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
