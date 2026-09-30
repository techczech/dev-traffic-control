import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'

/**
 * The screenshots strip: thumbnails read back as `data:` URLs over IPC (never
 * `file://` in the renderer — CSP allows `data:`), a paste-tile affordance, and
 * click-to-zoom. Removing a thumb drops it from the report; the PNG stays on
 * disk (the report is the truth of what is attached).
 *
 * A run's strip reads through the run (`requestPath`); a verdict's strip
 * (ticket 25) passes its own confined reader as `read`.
 */
export function ShotStrip({
  requestPath = '',
  read,
  screenshots,
  readOnly,
  onZoom,
  onRemove,
  onPasteHint
}: {
  requestPath?: string
  read?: (relPath: string) => Promise<string | null>
  screenshots: string[]
  readOnly: boolean
  /** `rel` names the screenshot, so the zoom can offer Mark up (ticket 30). */
  onZoom: (url: string, name: string, rel: string) => void
  onRemove: (relPath: string) => void
  onPasteHint: () => void
}): React.JSX.Element {
  const [urls, setUrls] = useState<Record<string, string>>({})
  // The latest reader, so a caller's inline function does not refetch every thumb.
  const reader = useRef(read)
  useLayoutEffect(() => {
    reader.current = read
  })

  useEffect(() => {
    let cancelled = false
    for (const rel of screenshots) {
      if (urls[rel]) continue
      const pending = reader.current ? reader.current(rel) : window.qa.readShot(requestPath, rel)
      void pending
        .then((url) => {
          if (!cancelled && url) setUrls((prev) => (prev[rel] ? prev : { ...prev, [rel]: url }))
        })
        .catch(() => {
          /* a missing shot simply keeps its placeholder */
        })
    }
    return () => {
      cancelled = true
    }
  }, [screenshots, requestPath, urls])

  function basename(rel: string): string {
    return rel.split('/').pop() ?? rel
  }

  return (
    <div className="shots">
      {screenshots.map((rel) => {
        const url = urls[rel]
        const name = basename(rel)
        return (
          <div className="thumb" key={rel}>
            <div className="thumbwrap">
              <button
                className="ph"
                aria-label={`Zoom ${name}`}
                onClick={() => url && onZoom(url, name, rel)}
              >
                {url ? <img src={url} alt={name} /> : <ImageIcon className="ic" strokeWidth={2} />}
              </button>
              {!readOnly && (
                <button
                  className="thumbx"
                  aria-label={`Remove ${name}`}
                  onClick={() => onRemove(rel)}
                >
                  <X className="ic" strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="fn" title={name}>
              {name}
            </div>
          </div>
        )
      })}
      {!readOnly && (
        <button className="pastetile" aria-label="Paste a screenshot" onClick={onPasteHint}>
          <ImageIcon className="ic" strokeWidth={2} />
          <span>
            <kbd>⌘V</kbd> paste
          </span>
        </button>
      )}
    </div>
  )
}
