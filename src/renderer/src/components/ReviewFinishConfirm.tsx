import { DISPOSITIONS } from '../lib/dispositions'
import type { Verdict } from '../../../main/qa/types'

/**
 * The Finish-review confirm sheet: always shown, never blocking.
 * The four dispositions sit on the sheet — same list, order, icons and letter
 * keys as the chip's flyout, the current one marked — so finishing with none
 * picked still records Not reviewed with no amber warning: the choice is now
 * offered here rather than described as missing. The final-comments box
 * writes the document item's own `comment` field, pre-filled with anything
 * already there so opening and confirming never silently discards an earlier
 * comment. Enter confirms and Esc cancels via Reading's key handler; while
 * focus is in the box, letters type and Enter makes a newline.
 */
export function ReviewFinishConfirm({
  dispositionLabel,
  current,
  comment,
  comments,
  sectionMarks,
  onPick,
  onCommentChange,
  onConfirm,
  onCancel
}: {
  dispositionLabel: string | null
  current: Verdict | null
  comment: string
  comments: number
  sectionMarks: number
  onPick: (v: Verdict) => void
  onCommentChange: (text: string) => void
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const what =
    `${comments} comment${comments === 1 ? '' : 's'}` +
    (sectionMarks > 0 ? ` and ${sectionMarks} section mark${sectionMarks === 1 ? '' : 's'}` : '')
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Finish review"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="sheet confirm">
        <h2>Finish review?</h2>
        <p>
          {dispositionLabel ? (
            <>
              The disposition <strong>{dispositionLabel}</strong>, {what} — stamped into report.json
              for the agent to collect.
            </>
          ) : (
            <>{what} will be stamped into report.json for the agent to collect.</>
          )}
        </p>
        <div className="deye">Disposition</div>
        <div className="disprows" role="group" aria-label="Disposition">
          {DISPOSITIONS.map(({ v, label, key, Icon }) => (
            <button
              key={v}
              className={`drow${current === v ? ` sel-${v}` : ''}`}
              aria-pressed={current === v}
              onClick={() => onPick(v)}
            >
              <Icon strokeWidth={2} />
              <span className="grow">{label}</span>
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>
        <label className="deye" htmlFor="finish-final-comment">
          Final comments
        </label>
        <textarea
          id="finish-final-comment"
          className="fcomment"
          rows={3}
          placeholder="Anything else the agent should know (optional)"
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
        />
        <div className="acts">
          <button className="secbtn" onClick={onCancel}>
            Keep reviewing
          </button>
          <button className="primbtn" onClick={onConfirm}>
            Finish review
          </button>
        </div>
      </div>
    </div>
  )
}
