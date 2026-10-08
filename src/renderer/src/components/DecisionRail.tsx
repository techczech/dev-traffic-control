import type { DecisionInfo } from '../lib/decisions'
import { decidedCount, pickChip } from '../lib/decisions'
import type { DecisionAnswer } from '../../../main/qa/types'

type Answers = Map<string, DecisionAnswer>

/** "3 of 10 decided" with its bar: the top of the wide rail. */
export function DecisionProgress({
  decisions,
  answers
}: {
  decisions: DecisionInfo[]
  answers: Answers
}): React.JSX.Element {
  const done = decidedCount(decisions, answers)
  return (
    <div className="progress">
      <div className="n">
        {done} of {decisions.length} <span>decided</span>
      </div>
      <div className="bar2">
        <i style={{ width: `${(100 * done) / Math.max(1, decisions.length)}%` }} />
      </div>
    </div>
  )
}

/** The decisions that sit under one section (or before the first heading), as rail rows. */
export function DecisionRailRows({
  decisions,
  answers,
  wide,
  current,
  onJump
}: {
  decisions: DecisionInfo[]
  answers: Answers
  wide: boolean
  current: string | null
  onJump: (id: string) => void
}): React.JSX.Element {
  return (
    <>
      {decisions.map((d) => {
        const chip = pickChip(answers.get(d.id)?.choice ?? '')
        return (
          <button
            key={d.id}
            type="button"
            className={`toc dec nest${chip ? ' done' : ''}${current === d.id ? ' cur' : ''}`}
            title={`${d.name}${chip ? `: ${chip}` : ' (not decided)'}`}
            aria-label={`Decision ${d.number} of ${d.total}: ${d.name}, ${
              chip ? `chosen ${chip}` : 'not decided'
            }`}
            onClick={() => onJump(d.id)}
          >
            <span className="dm" />
            <span className="tlbl">{d.name}</span>
            {wide &&
              (chip ? <span className="pick">{chip}</span> : <span className="open">?</span>)}
          </button>
        )
      })}
    </>
  )
}

/** Narrow: the "k/N" button at the top of the 46px rail. */
export function DecisionRailButton({
  decisions,
  answers,
  open,
  onToggle
}: {
  decisions: DecisionInfo[]
  answers: Answers
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`railbtn${open ? ' on' : ''}`}
      title="Sections and decisions"
      aria-label={`Sections and decisions: ${decidedCount(decisions, answers)} of ${decisions.length} decided`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="dm" />
      {decidedCount(decisions, answers)}/{decisions.length}
    </button>
  )
}

/** Narrow: the labelled list the button opens, decisions grouped under their sections. */
export function DecisionPopover({
  decisions,
  answers,
  headings,
  current,
  onJump,
  onClose
}: {
  decisions: DecisionInfo[]
  answers: Answers
  headings: { id: string; title: string }[]
  current: string | null
  onJump: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const groups: { key: string; title: string | null; items: DecisionInfo[] }[] = []
  const lead = decisions.filter((d) => !d.section)
  if (lead.length) groups.push({ key: '', title: null, items: lead })
  for (const h of headings) {
    const items = decisions.filter((d) => d.section === h.id)
    if (items.length) groups.push({ key: h.id, title: h.title, items })
  }
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="pop" role="dialog" aria-label="Sections and decisions">
        <div className="itemlist">
          <div className="il-head">
            <span className="il-title">Sections and decisions</span>
            <span className="il-count">
              {decidedCount(decisions, answers)} of {decisions.length} decided
            </span>
          </div>
          {groups.map((g) => (
            <div key={g.key}>
              {g.title && (
                <div className="il-row sec">
                  <span className="bar3" />
                  {g.title}
                </div>
              )}
              {g.items.map((d) => {
                const chip = pickChip(answers.get(d.id)?.choice ?? '')
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`il-row nest${chip ? ' done' : ''}${current === d.id ? ' cur' : ''}`}
                    onClick={() => onJump(d.id)}
                  >
                    <span className="il-dot" />
                    <span className="il-name">{d.name}</span>
                    <span className="il-sub">{chip || '?'}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
