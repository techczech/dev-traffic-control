import { useEffect, useState } from 'react'
import { useApp } from '../state/app'
import { agentStatusDisplay } from '../lib/agentStatus'

export function AgentStatus({ requestPath }: { requestPath: string }): React.JSX.Element {
  const { snapshot } = useApp()
  const [now, setNow] = useState(() => new Date())
  const claim = snapshot?.runs.find((run) => run.request.path === requestPath)?.watch
  const localMachine = snapshot?.localMachine ?? ''
  const display = agentStatusDisplay(claim, now, localMachine)
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div
      className={`status-chip agent-status ${display.tone}`}
      aria-live="polite"
      data-live={display.live}
    >
      {display.live && <span className="agent-status-dot" aria-hidden="true" />}
      {display.sentence}
    </div>
  )
}
