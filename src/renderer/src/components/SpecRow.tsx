import { ChevronRight } from 'lucide-react'
import type { SpecRowModel } from '../lib/specs'
import { formatDenseAge } from '../lib/dateVocabulary'

export function SpecRow({
  row,
  focused,
  now,
  onOpen
}: {
  row: SpecRowModel
  focused: boolean
  now: Date
  onOpen: () => void
}): React.JSX.Element {
  const age = formatDenseAge(row.ageSource, now)
  const agePhrase =
    row.state === 'Being written'
      ? `an agent started ${age}`
      : row.state === 'In conversation'
        ? `you commented ${age}`
        : row.state === 'Answered'
          ? age
          : `asked ${age}`
  const countPhrase =
    row.state === 'Being written'
      ? ''
      : [
          `${row.sectionCount} section${row.sectionCount === 1 ? '' : 's'}`,
          row.questionCount > 0
            ? `${row.questionCount} open question${row.questionCount === 1 ? '' : 's'}`
            : null
        ]
          .filter(Boolean)
          .join(' · ')
  const feedbackPhrase = [
    row.commentCount > 0 ? `${row.commentCount} comment${row.commentCount === 1 ? '' : 's'}` : null,
    row.sectionMarkCount > 0 ? `${row.sectionMarkCount} section flagged` : null
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <button
      type="button"
      className={`spec-row spec-state-${stateClass(row.state)}${focused ? ' focused' : ''}`}
      disabled={!row.openable}
      aria-label={`${row.openable ? 'Open' : 'Not ready'} ${row.title}`}
      onClick={onOpen}
    >
      <span className="spec-row-spine" aria-hidden="true" />
      <span className="spec-row-body">
        <span className="spec-row-app">{row.app}</span>
        <span className="spec-row-title">{row.title}</span>
        <span className="spec-row-meta">
          <strong>{row.state}</strong>
          <span aria-hidden="true">•</span>
          {agePhrase}
          {countPhrase && (
            <>
              <span aria-hidden="true">•</span>
              {countPhrase}
            </>
          )}
        </span>
        <span className="spec-row-progress">
          {row.state !== 'Being written' && (
            <span className="spec-progress-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(row.progress.ratio * 100)}%` }} />
            </span>
          )}
          <span>
            {row.progress.phrase}
            {feedbackPhrase ? ` · ${feedbackPhrase}` : ''}
          </span>
        </span>
      </span>
      <span className="spec-row-open" aria-hidden="true">
        {focused && row.openable && <kbd>↵ open</kbd>}
        <ChevronRight />
      </span>
    </button>
  )
}

function stateClass(state: SpecRowModel['state']): string {
  if (state === 'Needs your comment') return 'needs'
  if (state === 'In conversation') return 'conversation'
  if (state === 'Answered') return 'answered'
  return 'writing'
}
