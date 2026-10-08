import { useEffect, useState } from 'react'
import { finishedCollectionDisplay } from '../lib/collectionStatus'
import { useApp } from '../state/app'
import { CollectPromptButton } from './CollectPromptButton'

export function FinishedCollectionStatus({
  requestPath,
  title,
  completedAt,
  onError
}: {
  requestPath: string
  title: string
  completedAt: string
  onError?: () => void
}): React.JSX.Element {
  const { snapshot } = useApp()
  const [now, setNow] = useState(() => new Date())
  const run = snapshot?.runs.find((candidate) => candidate.request.path === requestPath)
  const display = finishedCollectionDisplay({
    completedAt,
    receiptsStartAt: snapshot?.receiptsStartAt,
    watch: run?.watch,
    collection: run?.collection,
    localMachine: snapshot?.localMachine ?? '',
    now
  })

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="collection-state" data-collection-state>
      {display && (
        <div className={`status-chip collection-state-pill ${display.tone}`} role="status">
          <span>{display.message}</span>
          {display.note && <span className="collection-state-note">{display.note}</span>}
        </div>
      )}
      <CollectPromptButton requestPath={requestPath} title={title} finished onError={onError} />
    </div>
  )
}
