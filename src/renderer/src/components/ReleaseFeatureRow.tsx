import { Check, ChevronRight, Flag } from 'lucide-react'
import { formatDenseDay } from '../lib/dateVocabulary'
import { featureReachedAt, type ReleaseBoardItem } from '../lib/releases'
import { VerdictPictures } from './VerdictPictures'

export function ReleaseFeatureRow({
  item,
  focused,
  now,
  readShot,
  howToOpen,
  pending,
  comment,
  onFocus,
  onToggleHowTo,
  onWorks,
  onFlag,
  onCommentChange,
  onCommentCommit
}: {
  item: ReleaseBoardItem
  focused: boolean
  now: Date
  /** Reads one of this release's verdict pictures (ticket 25). */
  readShot?: (relPath: string) => Promise<string | null>
  howToOpen: boolean
  pending: boolean
  comment: string
  onFocus: () => void
  onToggleHowTo: () => void
  onWorks: () => void
  onFlag: () => void
  onCommentChange: (comment: string) => void
  onCommentCommit: () => void
}): React.JSX.Element {
  if (item.kind === 'groundwork') {
    return (
      <div className="release-groundwork-row" role="listitem">
        <span className="release-groundwork-spine" aria-hidden="true" />
        <span className="release-groundwork-body">
          <strong>Groundwork</strong>
          <span className="release-groundwork-title">{item.title}</span>
          {item.prose && <span>{item.prose}</span>}
          <em>
            {item.unlocks
              ? `Unlocks ${lowercaseLead(item.unlocks)}`
              : 'Nothing here for you to try.'}
            {item.unlocks ? ' Nothing here for you to try.' : ''}
          </em>
        </span>
      </div>
    )
  }

  // Ticket 25: the day the feature reached its state, in the short form the
  // Recent requests rows use, right after the state word.
  const reachedAt = featureReachedAt(item)
  const updated = reachedAt ? formatDenseDay(reachedAt, now) : ''
  return (
    <div
      className={`release-feature-row release-state-${item.status}${focused ? ' focused' : ''}`}
      role="listitem"
      tabIndex={-1}
      onMouseDown={onFocus}
    >
      <span className="release-answer-controls">
        {item.answerable && (
          <>
            <button
              type="button"
              className={item.answer?.verdict === 'works' ? 'on' : ''}
              aria-label={`It works: ${item.title}`}
              aria-pressed={item.answer?.verdict === 'works'}
              disabled={pending}
              onClick={onWorks}
            >
              <Check aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`release-flag${item.answer?.verdict === 'off' ? ' on' : ''}`}
              aria-label={`Something is off: ${item.title}`}
              aria-pressed={item.answer?.verdict === 'off'}
              disabled={pending}
              onClick={onFlag}
            >
              <Flag aria-hidden="true" />
            </button>
          </>
        )}
      </span>
      <span className="release-feature-spine" aria-hidden="true" />
      <span className="release-feature-body">
        <span className="release-feature-title">{item.title}</span>
        <span className="release-feature-state">
          <strong>{item.state}</strong>
          {updated && (
            <>
              <span aria-hidden="true">•</span>
              {updated}
            </>
          )}
        </span>
        {item.howToCheck && (
          <span className="release-how-to">
            <button type="button" aria-expanded={howToOpen} onClick={onToggleHowTo}>
              <ChevronRight className={howToOpen ? 'open' : ''} aria-hidden="true" />
              How to check
            </button>
            {howToOpen && <span className="release-how-to-body">{item.howToCheck}</span>}
          </span>
        )}
        {item.answer?.verdict === 'off' && (
          <textarea
            className="release-problem-note"
            rows={2}
            value={comment}
            aria-label={`What is off with ${item.title}`}
            placeholder="What is off?"
            onChange={(event) => onCommentChange(event.target.value)}
            onBlur={onCommentCommit}
          />
        )}
        {readShot && item.answer?.screenshots && (
          <VerdictPictures screenshots={item.answer.screenshots} read={readShot} />
        )}
      </span>
    </div>
  )
}

function lowercaseLead(value: string): string {
  return value ? `${value[0].toLocaleLowerCase()}${value.slice(1)}` : value
}
