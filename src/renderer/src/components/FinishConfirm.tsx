/**
 * The gentle finish confirm sheet (Enter confirms, Esc
 * cancels — both handled by the Runner's key handler). Shown only when items
 * remain unanswered; a fully answered run finishes directly.
 */
export function FinishConfirm({
  unanswered,
  total,
  onConfirm,
  onCancel
}: {
  unanswered: number
  total: number
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const isOne = unanswered === 1
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Finish run"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="sheet confirm">
        <h2>Finish run?</h2>
        <p>
          {unanswered} of {total} items {isOne ? 'is' : 'are'} still unanswered. Finishing now
          records {isOne ? 'it' : 'them'} as unanswered in the report.
        </p>
        <div className="acts">
          <button className="secbtn" onClick={onCancel}>
            Keep testing
          </button>
          <button className="primbtn" onClick={onConfirm}>
            Finish run
          </button>
        </div>
      </div>
    </div>
  )
}
