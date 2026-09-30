import { BadgeCheck } from 'lucide-react'
import type { ReportItem } from '../../../main/qa/types'

/**
 * The spine rail (ADR-0006): a slim column of verdict-filled segments that is
 * progress, TOC and navigation at once. Labels appear only at expanded width
 * (CSS, taste rule 1 — rails stay light). A terminal stamp segment finishes
 * the run and fills when done.
 */
export function SpineRail({
  items,
  current,
  finished,
  finishedLabel,
  onJump,
  onFinish,
  disabled = false
}: {
  items: ReportItem[]
  current: number
  finished: boolean
  finishedLabel: string
  onJump: (index: number) => void
  onFinish: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <nav className="rail" aria-label="Run items">
      <div className="segs">
        {items.map((it, i) => {
          const flagged = it.flagged.length > 0
          const showDot = (it.status === 'partial' || it.status === 'fail') && flagged
          return (
            <button
              key={it.id}
              className={`seg${i === current ? ' cur' : ''}`}
              title={it.title}
              aria-label={`Item ${i + 1}: ${it.title} — ${it.status}${
                flagged ? ` — ${it.flagged.length} flagged` : ''
              }${i === current ? ' (current)' : ''}`}
              aria-current={i === current}
              onClick={() => onJump(i)}
            >
              <span className={`bar${it.status !== 'unanswered' ? ` v-${it.status}` : ''}`}>
                {showDot && <span className="fd" />}
              </span>
              <span className="slbl">{it.title}</span>
            </button>
          )
        })}
      </div>
      <button
        className={`stampseg${finished ? ' on' : ''}`}
        aria-label="Finish run"
        title="Finish run"
        disabled={disabled}
        onClick={onFinish}
      >
        <BadgeCheck className="ic" strokeWidth={2} />
        <span className="stlbl">{finishedLabel}</span>
      </button>
    </nav>
  )
}
