import { useState } from 'react'
import { Flag, AlignJustify, Plus } from 'lucide-react'
import { useCommandScope } from '../commands/provider'
import { newReleaseCandidate, type MoveTarget } from '../lib/roadmapReleases'

/**
 * "Move to…": the release list on one feature. It is
 * the keyboard path for what a drag does, so it is fully operable without a
 * pointer: Up and Down choose, Enter moves, Escape closes. "A new release…"
 * asks for a version, which must be later than the pending one.
 */
export function RoadmapMoveMenu({
  targets,
  pending,
  onPick,
  onClose
}: {
  targets: MoveTarget[]
  pending: string | undefined
  onPick: (candidate: string | null) => void
  onClose: () => void
}): React.JSX.Element {
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      targets.findIndex((t) => !t.current)
    )
  )
  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState('')
  const total = targets.length + 1

  function choose(index: number): void {
    if (index < targets.length) onPick(targets[index].candidate)
    else setAsking(true)
  }

  function submitNew(): void {
    const version = newReleaseCandidate(typed, pending)
    if (!version) {
      setProblem(
        pending
          ? `Type a version later than ${pending}, such as 0.38.0.`
          : 'Type a version, such as 0.38.0.'
      )
      return
    }
    onPick(version)
  }

  useCommandScope({
    'nav.move-down': {
      enabled: !asking,
      priority: 30,
      handler: () => setActive((index) => Math.min(index + 1, total - 1))
    },
    'nav.move-up': {
      enabled: !asking,
      priority: 30,
      handler: () => setActive((index) => Math.max(index - 1, 0))
    },
    'nav.open-selection': {
      enabled: !asking,
      priority: 30,
      handler: () => choose(active)
    },
    'app.close-back': {
      priority: 30,
      handler: () => (asking ? setAsking(false) : onClose())
    }
  })

  return (
    <div className="rr-menu" role="menu" aria-label="Move to release">
      <div className="rr-menu-h">Move to release</div>
      {targets.map((target, index) => (
        <div key={target.key}>
          {target.kind === 'unscheduled' && <div className="rr-menu-rule" />}
          <button
            type="button"
            role="menuitem"
            className={`rr-menu-i${target.current ? ' current' : ''}${active === index && !asking ? ' active' : ''}`}
            disabled={target.current}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(index)}
          >
            {target.kind === 'unscheduled' ? (
              <AlignJustify aria-hidden="true" />
            ) : (
              <Flag aria-hidden="true" />
            )}
            <span className="n">{target.label}</span>
            <span className="c">
              {target.current
                ? 'current'
                : `${target.count} feature${target.count === 1 ? '' : 's'}`}
            </span>
          </button>
        </div>
      ))}
      <div className="rr-menu-rule" />
      {asking ? (
        <form
          className="rr-menu-new"
          onSubmit={(event) => {
            event.preventDefault()
            submitNew()
          }}
        >
          <label htmlFor="rr-new-release">New release version</label>
          <input
            id="rr-new-release"
            value={typed}
            autoFocus
            placeholder={pending ? `later than ${pending}` : '0.1.0'}
            onChange={(event) => {
              setTyped(event.target.value)
              setProblem('')
            }}
          />
          {problem && <p className="rr-menu-problem">{problem}</p>}
          <button type="submit" className="rr-btn first">
            Move there
          </button>
        </form>
      ) : (
        <button
          type="button"
          role="menuitem"
          className={`rr-menu-i${active === targets.length ? ' active' : ''}`}
          onMouseEnter={() => setActive(targets.length)}
          onClick={() => setAsking(true)}
        >
          <Plus aria-hidden="true" />
          <span className="n">A new release…</span>
        </button>
      )}
    </div>
  )
}
