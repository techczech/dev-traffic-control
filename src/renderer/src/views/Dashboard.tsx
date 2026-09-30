import { useApp } from '../state/app'
import { formatClock, reviewDispositionLabel, reviewOutcomeLabel } from '../lib/format'
import { formatFullAge } from '../lib/dateVocabulary'
import type { RunRowState } from '../lib/roadmap'
import { MiniSpine } from '../components/MiniSpine'
import { FleetOverview } from './FleetOverview'
import type { ItemStatus, Thread } from '../../../main/qa/types'
import { overviewDestination } from '../lib/overviewDestination'
import { ProjectHome } from './ProjectHome'

const FORM_CLASS: Record<string, string> = { sidequest: 'sq', graft: 'graft', strut: 'strut' }
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

const plural = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

function reviewWorkHistory(state: RunRowState): string {
  const evidence = state.evidence
  if (!evidence) return 'Work noted'
  const channels = [
    evidence.comments,
    evidence.flags,
    evidence.quotes,
    evidence.sectionMarks,
    evidence.decisions,
    evidence.screenshots,
    evidence.observations,
    evidence.noteFiles
  ].filter((count) => count > 0).length
  if (channels !== 1) return 'Work noted'
  if (evidence.comments) return plural(evidence.comments, 'comment')
  if (evidence.flags) return `${plural(evidence.flags, 'expectation')} flagged`
  if (evidence.quotes) return `${plural(evidence.quotes, 'annotation')} added`
  if (evidence.sectionMarks) return `${plural(evidence.sectionMarks, 'section')} marked`
  if (evidence.decisions) return `${plural(evidence.decisions, 'decision')} answered`
  if (evidence.screenshots) return `${plural(evidence.screenshots, 'screenshot')} added`
  if (evidence.observations) return plural(evidence.observations, 'observation')
  return plural(evidence.noteFiles, 'linked note')
}

function hasNonStatusWork(state: RunRowState): boolean {
  const evidence = state.evidence
  return !!(
    evidence &&
    (evidence.comments ||
      evidence.flags ||
      evidence.quotes ||
      evidence.sectionMarks ||
      evidence.decisions ||
      evidence.screenshots ||
      evidence.observations ||
      evidence.noteFiles)
  )
}

function shapeHistory(state: RunRowState): string | null {
  if (!state.shape) return null
  const shapeLabel =
    state.shape === 'degraded' ? 'Plain request — no checks to answer' : 'Optional checks only'

  switch (state.state) {
    case 'unknown':
      return shapeLabel
    case 'never-opened':
      return `${shapeLabel} · Not opened yet`
    case 'opened':
      return `${shapeLabel} · Opened — no work noted yet`
    case 'part-answered': {
      const work =
        state.shape === 'parked-only' && state.evidence?.statuses
          ? `${state.evidence.statuses} answered`
          : reviewWorkHistory(state)
      return `${shapeLabel} · ${work[0].toLowerCase()}${work.slice(1)}`
    }
    case 'all-answered':
      return `${shapeLabel} · ${state.answered} of ${state.total} answered · Finish outstanding`
    case 'report-error':
      return `${shapeLabel} · Report unreadable`
    case 'finished':
      return `${shapeLabel} · Finished ${formatClock(state.completedAt)}`
  }
}

function runHistory(
  typeLabel: 'Test request' | 'Document review',
  state: RunRowState,
  now: Date
): string | null {
  const shaped = shapeHistory(state)
  if (shaped) return shaped
  const review = typeLabel === 'Document review'
  switch (state.state) {
    case 'unknown':
      return null
    case 'never-opened':
      return 'Not opened yet'
    case 'opened':
      return review ? 'Opened — nothing noted yet' : 'Opened — nothing answered yet'
    case 'part-answered':
      if (review) {
        if (state.reviewDisposition) {
          const disposition =
            state.reviewDisposition === 'skip'
              ? 'Marked not reviewed'
              : reviewDispositionLabel(state.reviewDisposition)
          return state.evidence
            ? `${disposition} · ${reviewWorkHistory(state).toLowerCase()}`
            : disposition
        }
        return reviewWorkHistory(state)
      }
      return state.answered > 0
        ? `${state.answered} of ${state.total} answered${hasNonStatusWork(state) ? ' · work noted' : ''}`
        : `Work noted · 0 of ${state.total} answered`
    case 'all-answered':
      if (review && state.reviewDisposition) {
        const disposition =
          state.reviewDisposition === 'skip'
            ? 'Marked not reviewed'
            : reviewDispositionLabel(state.reviewDisposition)
        return `${disposition} · Finish outstanding${
          state.evidence ? ` · ${reviewWorkHistory(state).toLowerCase()}` : ''
        }`
      }
      return `${state.answered} of ${state.total} answered · Finish outstanding${
        hasNonStatusWork(state) ? ' · work noted' : ''
      }`
    case 'report-error':
      return 'Report unreadable — repair the report file'
    case 'finished':
      if (review && state.reviewDisposition) return reviewOutcomeLabel(state.reviewDisposition)
      return state.collectionTracking && state.collectionAgent
        ? `Finished ${formatFullAge(state.completedAt ?? '', now)} · collected by ${cap(state.collectionAgent)}`
        : state.collectionTracking
          ? `Finished ${formatFullAge(state.completedAt ?? '', now)} · not collected yet`
          : `Finished ${formatFullAge(state.completedAt ?? '', now)}`
  }
}

export function RunRowProgress({
  typeLabel,
  state,
  cells,
  now
}: {
  typeLabel: 'Test request' | 'Document review'
  state: RunRowState
  cells: ItemStatus[]
  now: Date
}): React.JSX.Element {
  const history = runHistory(typeLabel, state, now)
  const tone =
    state.state === 'report-error'
      ? 'status-waiting'
      : state.state === 'finished'
        ? 'status-ready'
        : state.state === 'opened' ||
            state.state === 'part-answered' ||
            state.state === 'all-answered'
          ? 'status-progress'
          : 'status-inactive'
  const combinedLabel = `${typeLabel}${history ? ` · ${history}` : ''}`
  return (
    <span className="drow2-progress" aria-label={combinedLabel}>
      <span className="drow2-progress-bar">
        <MiniSpine cells={cells} small done={state.state === 'finished'} />
        <span className="drow2-history visually-hidden">{combinedLabel}</span>
        <span className="drow2-type" aria-hidden="true">
          {typeLabel === 'Document review' ? 'Review' : 'Test'}
        </span>
      </span>
      {history && (
        <span className={`drow2-status status-chip ${tone}`} aria-hidden="true">
          {history}
        </span>
      )}
    </span>
  )
}

/** The first tab follows the window scope through one pure decision seam. */
export function Dashboard(): React.JSX.Element {
  const { snapshot, scope } = useApp()
  if (snapshot?.rootMissing) {
    return (
      <div className="view roadmap">
        <div className="empty">
          <p>
            Record folder not found at {snapshot.root}. Open Settings to point Dev Traffic Control
            at it.
          </p>
        </div>
      </div>
    )
  }
  const destination = overviewDestination(scope)
  return destination.kind === 'fleet' ? (
    <FleetOverview />
  ) : (
    <ProjectHome key={destination.slug} slug={destination.slug} />
  )
}

export function ThreadView({ threadId }: { threadId: string }): React.JSX.Element {
  const { snapshot } = useApp()
  const thread = snapshot?.threads.find((candidate) => candidate.id === threadId) ?? null

  return (
    <div className="view roadmap">
      <div className="reader">
        {thread ? (
          <ThreadReader thread={thread} now={new Date()} />
        ) : (
          <div className="rowempty">This thread is not available in the current record.</div>
        )}
      </div>
    </div>
  )
}

function ThreadReader({ thread, now }: { thread: Thread; now: Date }): React.JSX.Element {
  return (
    <>
      <header className="rhead">
        <h2>{thread.title}</h2>
        <div className="meta">
          <span className={`chip${FORM_CLASS[thread.form] ? ' ' + FORM_CLASS[thread.form] : ''}`}>
            {cap(thread.form)}
          </span>
          {thread.projects.map((p) => (
            <span key={p} className="chip">
              {p}
            </span>
          ))}
          <span className="grow" />
          <span className="aged">
            {thread.move === 'me'
              ? 'your move'
              : thread.move === 'agent'
                ? "agent's move"
                : 'nobody'}{' '}
            · {formatFullAge(thread.lastAt, now)}
          </span>
        </div>
      </header>
      <div className="rbody" data-find-scope>
        {thread.entries.map((e) => {
          const first =
            e.body
              .split(/\r?\n/)
              .map((l) => l.trim())
              .find(Boolean) ?? ''
          const rest = e.body.trim()
          return (
            <article key={e.path} className="entry" data-source-file={e.path}>
              <div className="ehead">
                <span className={`who${e.by !== 'agent' ? ' dom' : ''}`}>
                  {e.by !== 'agent' ? 'You' : 'Agent'}
                </span>
                {e.dictation && <span className="dict">dictated</span>}
                <span className="grow" />
                <span className="when">{formatFullAge(e.at, now)}</span>
              </div>
              <div className="etext">{rest || first}</div>
              {e.parents.length > 0 ? (
                <div className="parents">
                  fed by{' '}
                  {e.parents.map((p, i) => (
                    <b key={p}>
                      {p}
                      {i < e.parents.length - 1 ? ', ' : ''}
                    </b>
                  ))}
                </div>
              ) : e.dictation ? (
                <div className="parents">dictated · quality may vary</div>
              ) : (
                <div className="parents">no parents — unattributable</div>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}
