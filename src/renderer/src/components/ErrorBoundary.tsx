import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * One bad record must never blank the window. Agents write the frontmatter and
 * bodies the views read, so a shape nobody planned for can throw while a card
 * renders. The boundary catches that and draws a small note in the card's place;
 * the rest of the window keeps working.
 */
interface Props {
  /** What failed, in the reader's words: "Waiting on you", "Feature requests". */
  label: string
  children: ReactNode
  /** Replaces the default note, e.g. `null` for chrome that has no room for one. */
  fallback?: ReactNode
}

interface State {
  failed: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Could not show "${this.props.label}"`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div className="phome-quiet bad-record" role="note">
        Could not show {this.props.label}: a record it reads has a value this app does not
        understand. The rest of the window is unaffected.
      </div>
    )
  }
}
