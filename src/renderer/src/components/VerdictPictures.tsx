import { useState } from 'react'
import { useCommandScope } from '../commands/provider'
import { ShotStrip } from './ShotStrip'

/**
 * An answered feature's pictures on Releases, under its comment.
 * Read-only thumbnails through the confined verdict-picture reader; a click
 * zooms one, and Esc or a click closes it.
 */
export function VerdictPictures({
  screenshots,
  read
}: {
  screenshots: string[]
  read: (relPath: string) => Promise<string | null>
}): React.JSX.Element | null {
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null)
  useCommandScope(zoom ? { 'app.close-back': { priority: 110, handler: () => setZoom(null) } } : {})
  if (screenshots.length === 0) return null
  return (
    <span className="release-verdict-pictures">
      <ShotStrip
        read={read}
        screenshots={screenshots}
        readOnly
        onZoom={(url, name) => setZoom({ url, name })}
        onRemove={() => {}}
        onPasteHint={() => {}}
      />
      {zoom && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot ${zoom.name}`}
          onClick={() => setZoom(null)}
        >
          <img className="zoomimg" src={zoom.url} alt={zoom.name} />
        </div>
      )}
    </span>
  )
}
