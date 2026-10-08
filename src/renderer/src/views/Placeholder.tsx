import { ArrowLeft } from 'lucide-react'
import { useApp } from '../state/app'

/**
 * A placeholder for a surface that is not built yet: the correct title and
 * one honest sentence. Esc / ← go back.
 */
export function Placeholder({
  title,
  line,
  mono
}: {
  title: string
  line: string
  mono?: boolean
}): React.JSX.Element {
  const { back, canGoBack } = useApp()

  return (
    <div className="view">
      <div className="vhead">
        {canGoBack && (
          <button className="backbtn" aria-label="Go back" onClick={back}>
            <ArrowLeft className="ic" strokeWidth={2} />
          </button>
        )}
        <span className={`vt${mono ? ' mono' : ''}`}>{title}</span>
        <span className="grow" />
      </div>
      <div className="placeholder">
        <div className="motif" aria-hidden="true">
          <i style={{ height: 16 }} />
          <i style={{ height: 24 }} />
          <i style={{ height: 20 }} />
        </div>
        <p>{line}</p>
      </div>
    </div>
  )
}
