import { useEffect, useState } from 'react'
import { Image as ImageIcon, Pencil } from 'lucide-react'
import type { PictureMarkup } from '../../../main/qa/types'
import { shapeName } from '../lib/markup'

/**
 * A saved mark-up in the answer: the marked-up copy as a
 * thumbnail, the numbered notes under it in the same words the reviewer typed, and
 * Edit marks, which reopens the mark-up view on the original picture.
 */
export function MarkedPictures({
  requestPath,
  markups,
  readOnly,
  caption,
  onEdit,
  onZoom
}: {
  requestPath: string
  markups: PictureMarkup[]
  readOnly: boolean
  caption: (markup: PictureMarkup) => string
  onEdit: (markup: PictureMarkup) => void
  onZoom?: (url: string, name: string) => void
}): React.JSX.Element | null {
  if (markups.length === 0) return null
  return (
    <div className="mkanswers">
      {markups.map((m) => (
        <MarkedPicture
          key={m.picture}
          requestPath={requestPath}
          markup={m}
          readOnly={readOnly}
          caption={caption(m)}
          onEdit={() => onEdit(m)}
          onZoom={onZoom}
        />
      ))}
    </div>
  )
}

function MarkedPicture({
  requestPath,
  markup,
  readOnly,
  caption,
  onEdit,
  onZoom
}: {
  requestPath: string
  markup: PictureMarkup
  readOnly: boolean
  caption: string
  onEdit: () => void
  onZoom?: (url: string, name: string) => void
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    window.qa.readShot(requestPath, markup.marked).then(
      (u) => current && setUrl(u),
      () => {
        /* a missing copy keeps its placeholder */
      }
    )
    return () => {
      current = false
    }
  }, [requestPath, markup.marked])
  // Numbers pair the picture with the list only when the picture carries pins.
  const numbered = markup.notes !== 'picture'
  const name = markup.marked.split('/').pop() ?? markup.marked
  return (
    <div className="mkans" data-markup={markup.picture}>
      <div className="mkans-h">
        <b>{caption}</b>
        <span>{numbered ? 'numbered marks, notes below' : 'with notes on the picture'}</span>
        {!readOnly && (
          <button type="button" className="mkedit" onClick={onEdit}>
            <Pencil strokeWidth={2} aria-hidden="true" />
            Edit marks
          </button>
        )}
      </div>
      <button
        type="button"
        className="mkthumb"
        aria-label={`Zoom ${name}`}
        onClick={() => url && onZoom?.(url, name)}
      >
        {url ? <img src={url} alt={`${caption} with marks`} /> : <ImageIcon strokeWidth={2} />}
      </button>
      <ol className="mknotes">
        {markup.marks.map((mark) => (
          <li key={mark.n}>
            {numbered && <span className="mkpin sm">{mark.n}</span>}
            <span className="mkkind">{shapeName(mark.shape)}</span>
            <span className="mknote">{mark.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
