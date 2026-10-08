import { Quote as QuoteIcon, X } from 'lucide-react'
import type { ReportItem } from '../../../main/qa/types'
import { growTextarea, observeTextareaGrowth } from '../lib/growTextarea'

/** Show a bullet's text without its `**bold**` markers — the quote is plain italic. */
function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1')
}

/**
 * Quote blocks: every flagged bullet and every text
 * selection becomes a block of quoted line + its own comment field, sitting
 * above the general comment which flag/unflag never touches. Flag blocks show
 * only on partial/fail; selection quotes persist across verdict changes.
 */
export function QuoteBlocks({
  item,
  flaggable,
  readOnly,
  onUnflag,
  onFlagComment,
  onUnquote,
  onQuoteComment
}: {
  item: ReportItem
  flaggable: boolean
  readOnly: boolean
  onUnflag: (expectedIndex: number) => void
  onFlagComment: (expectedIndex: number, comment: string) => void
  onUnquote: (quoteIndex: number) => void
  onQuoteComment: (quoteIndex: number, comment: string) => void
}): React.JSX.Element | null {
  const tone = item.status === 'fail' ? 'red' : 'amber'
  const showFlags = flaggable && item.flagged.length > 0
  if (!showFlags && item.quotes.length === 0) return null

  return (
    <div className="qchips">
      {showFlags &&
        item.flagged.map((f) => (
          <div className={`qblock ${tone}`} key={`f${f.expectedIndex}`}>
            <div className="qhead">
              <span className="qmark mono">E{f.expectedIndex + 1}</span>
              <span className="qtxt">“{stripBold(f.text)}”</span>
              {!readOnly && (
                <button
                  className="qx"
                  aria-label={`Remove flag on expected bullet ${f.expectedIndex + 1}`}
                  onClick={() => onUnflag(f.expectedIndex)}
                >
                  <X className="ic" strokeWidth={2} />
                </button>
              )}
            </div>
            <textarea
              className="qcomment"
              rows={1}
              ref={(textarea) => {
                if (textarea) return observeTextareaGrowth(textarea)
                return
              }}
              data-flag-comment={`${item.id}:${f.expectedIndex}`}
              placeholder="What’s wrong here…"
              aria-label={`Comment on flagged bullet ${f.expectedIndex + 1}`}
              value={f.comment}
              readOnly={readOnly}
              onFocus={(event) => growTextarea(event.currentTarget)}
              onInput={(event) => growTextarea(event.currentTarget)}
              onChange={(event) => onFlagComment(f.expectedIndex, event.currentTarget.value)}
            />
          </div>
        ))}
      {item.quotes.map((q, qi) => (
        <div className="qblock sel" key={`q${qi}`}>
          <div className="qhead">
            <span className="qmark">
              <QuoteIcon className="ic" strokeWidth={2} />
            </span>
            <span className="qtxt">“{q.text}”</span>
            {!readOnly && (
              <button className="qx" aria-label="Remove quote" onClick={() => onUnquote(qi)}>
                <X className="ic" strokeWidth={2} />
              </button>
            )}
          </div>
          <textarea
            className="qcomment"
            rows={1}
            ref={(textarea) => {
              if (textarea) return observeTextareaGrowth(textarea)
              return
            }}
            placeholder="What’s wrong here…"
            aria-label="Comment on this quote"
            value={q.comment}
            readOnly={readOnly}
            onFocus={(event) => growTextarea(event.currentTarget)}
            onInput={(event) => growTextarea(event.currentTarget)}
            onChange={(event) => onQuoteComment(qi, event.currentTarget.value)}
          />
        </div>
      ))}
    </div>
  )
}
