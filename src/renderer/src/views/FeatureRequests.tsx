import { useMemo, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCopy,
  Link2,
  Search
} from 'lucide-react'
import type { ProjectPool } from '../../../main/qa/pool'
import { useCommandScope } from '../commands/provider'
import { useApp } from '../state/app'
import { requestKey } from '../lib/inbox'
import { projectDisplayName } from '../lib/projectStanding'
import {
  featureRequestRows,
  filterRequests,
  groupRequests,
  noPlanBanner,
  tallyRequests,
  type FeatureRequestRow,
  type RequestFilter
} from '../lib/featureRequests'
import { recordIndex, type ChipTarget } from '../lib/recordChips'
import { planThisPrompt, reviewAllPrompt } from '../lib/agentPrompts'
import { readStartedPending } from '../lib/roadmapLayout'
import {
  REQUEST_GROUPS,
  reviewerEntryText,
  type RequestAction,
  type RequestGroup
} from '../lib/requestFate'
import { FateChip, FeatureRequestCard } from '../components/FeatureRequestCard'

/**
 * The Feature requests tab (ticket 38; drawings `sugg-b-*`): everything he said
 * that became a roadmap idea, grouped by what happened to it. It reads the same
 * idea files as Roadmap. Answers go back through the existing roadmap idea
 * write (`writePoolIdea`, action `edit`), as a reviewer entry appended to the
 * idea's body; the tab adds no write of its own.
 */

const FILTERS: ReadonlyArray<{ id: RequestFilter; label: string }> = [
  { id: 'everything', label: 'Everything' },
  { id: 'waiting', label: 'Waiting on you' },
  { id: 'none', label: 'No plan' },
  { id: 'planned', label: 'On the roadmap' },
  { id: 'finished', label: 'Finished' }
]

const TALLY_LABELS: Record<RequestGroup, string> = {
  waiting: 'Waiting on you',
  none: 'No plan yet (agent owes)',
  planned: 'On the roadmap',
  finished: 'Finished, folded'
}

function today(now: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

export function FeatureRequests(): React.JSX.Element {
  const {
    snapshot,
    scope,
    setScope,
    view,
    navigate,
    showToast,
    helpOpen,
    switcherOpen,
    markSeen,
    housekeeping
  } = useApp()
  const [filter, setFilter] = useState<RequestFilter>('everything')
  const [query, setQuery] = useState('')
  const [onlyNoPlan, setOnlyNoPlan] = useState(false)
  const [finishedOpen, setFinishedOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [optimistic, setOptimistic] = useState<{
    scan: string | null
    pools: Map<string, ProjectPool>
  }>({ scan: null, pools: new Map() })

  // A write answers with the pool it made; draw it until the next scan arrives.
  const shown = useMemo(() => {
    if (!snapshot || optimistic.scan !== snapshot.scannedAt || optimistic.pools.size === 0) {
      return snapshot
    }
    return {
      ...snapshot,
      pools: snapshot.pools.map((pool) => optimistic.pools.get(pool.project) ?? pool)
    }
  }, [snapshot, optimistic])
  // Ages are read as of the latest scan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [snapshot])
  const rows = useMemo(
    () => featureRequestRows(shown, scope, now, readStartedPending()),
    [shown, scope, now]
  )
  const tally = useMemo(() => tallyRequests(rows), [rows])

  // The card a link or a Dash row asked for.
  const asked =
    view.kind === 'requests' && view.idea
      ? `${view.project ?? (scope.kind === 'project' ? scope.slug : '')}/${view.idea}`
      : null
  const [openKey, setOpenKey] = useState<string | null>(asked)
  // A new ask while this tab is open opens its card (set during render, not in an effect).
  const [seenAsk, setSeenAsk] = useState(asked)
  if (asked !== seenAsk) {
    setSeenAsk(asked)
    if (asked) setOpenKey(asked)
  }
  const openRow = openKey ? (rows.find((row) => row.key === openKey) ?? null) : null

  const matching = useMemo(() => {
    const list = filterRequests(rows, filter, query)
    return onlyNoPlan ? list.filter((row) => row.group !== 'finished' && row.noPlan) : list
  }, [rows, filter, query, onlyNoPlan])
  const groups = useMemo(() => groupRequests(matching, tally), [matching, tally])
  const finishedShown = finishedOpen || filter === 'finished'
  const visible = groups.flatMap((group) => (group.foldable && !finishedShown ? [] : group.rows))
  const active =
    selected && visible.some((row) => row.key === selected) ? selected : (visible[0]?.key ?? null)
  const activeIndex = active ? visible.findIndex((row) => row.key === active) : -1
  const commandsOn = !helpOpen && !switcherOpen && !openRow

  useCommandScope({
    'nav.move-down': {
      enabled: commandsOn && visible.length > 0,
      handler: () =>
        setSelected(visible[Math.min(activeIndex + 1, visible.length - 1)]?.key ?? null)
    },
    'nav.move-up': {
      enabled: commandsOn && visible.length > 0,
      handler: () => setSelected(visible[Math.max(activeIndex - 1, 0)]?.key ?? null)
    },
    'nav.open-selection': {
      enabled: commandsOn && !!active,
      handler: () => active && setOpenKey(active)
    },
    'requests.toggle-finished': {
      enabled: commandsOn,
      handler: () => setFinishedOpen((open) => !open)
    },
    'requests.review-all': {
      enabled: commandsOn && rows.length > 0,
      handler: () => void copyReviewAll()
    },
    'requests.show-no-plan': {
      enabled: commandsOn && tally.owedPlan > 0,
      handler: () => setOnlyNoPlan((on) => !on)
    },
    'app.close-back': {
      enabled: !helpOpen && !switcherOpen && !!openRow,
      priority: 20,
      handler: () => setOpenKey(null)
    }
  })

  const index = useMemo(
    () =>
      recordIndex(shown, openRow ? [openRow.project] : (shown?.projects ?? []), now, housekeeping),
    [shown, openRow, now, housekeeping]
  )

  const openChip = (target: ChipTarget): void => {
    if (target.kind === 'runner') markSeen(requestKey(snapshot?.root ?? '', target.path))
    if (target.kind === 'requests') setOpenKey(`${target.project}/${target.idea}`)
    navigate(target)
  }

  async function copyPrompt(text: string, done: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      showToast(done)
    } catch {
      showToast('The prompt could not be copied.')
    }
  }

  function copyReviewAll(): Promise<void> {
    return copyPrompt(
      reviewAllPrompt({
        kind: scope.kind === 'project' ? 'project' : 'all',
        ...(scope.kind === 'project' ? { project: scope.slug } : {}),
        count: rows.length
      }),
      'Copied. Paste it into an agent session to review every request.'
    )
  }

  function copyPlan(row: FeatureRequestRow): Promise<void> {
    return copyPrompt(
      planThisPrompt({ project: row.project, id: row.id, title: row.title }),
      'Copied. Paste it into an agent session to get a plan.'
    )
  }

  async function answer(
    row: FeatureRequestRow,
    action: RequestAction,
    note: string
  ): Promise<boolean> {
    if (pending || !shown) return false
    if (action.id === 'open-roadmap') {
      if (scope.kind !== 'project') setScope({ kind: 'project', slug: row.project })
      navigate({ kind: 'roadmap' })
      return true
    }
    setPending(true)
    try {
      const pool = shown.pools.find((candidate) => candidate.project === row.project)
      const idea = pool?.ideas.find((candidate) => candidate.id === row.id)
      if (!idea) throw new Error('That idea is no longer in the Roadmap.')
      const said = action.asks === 'release' ? `${action.answer} to ${note.trim()}` : action.answer
      const entry = reviewerEntryText({
        answer: said,
        note: action.asks === 'text' ? note : '',
        at: today(new Date())
      })
      const result = await window.qa.writePoolIdea({
        project: row.project,
        action: 'edit',
        id: row.id,
        appendEntry: entry,
        // His yes puts the idea in the pending release; taking it off returns it to his queue.
        ...(action.id === 'approve'
          ? { fate: 'planned' as const, ...(row.pending ? { candidate: row.pending } : {}) }
          : action.id === 'take-off'
            ? { fate: 'waiting' as const, candidate: null }
            : {})
      })
      setOptimistic((previous) => ({
        scan: snapshot?.scannedAt ?? null,
        pools: new Map(
          previous.scan === snapshot?.scannedAt ? previous.pools : new Map<string, ProjectPool>()
        ).set(row.project, result.pool)
      }))
      showToast(
        action.id === 'approve'
          ? `Approved. It is in ${row.pending ? `Pending ${row.pending}` : 'Unscheduled'} on the Roadmap.`
          : 'Sent. The agent reads it next.'
      )
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The answer could not be saved.')
      return false
    } finally {
      setPending(false)
    }
  }

  const showProject = scope.kind === 'all'
  const scopeName =
    scope.kind === 'project' ? projectDisplayName(snapshot?.releases, scope.slug) : 'All projects'

  if (openRow) {
    return (
      <div className="view roadmap-pool-view roadmap-project-layout fr-view">
        <div className="roadmap-project-detail">
          <FeatureRequestCard
            key={openRow.key}
            row={openRow}
            index={index}
            showProject={showProject}
            pending={pending}
            onBack={() => setOpenKey(null)}
            onOpen={openChip}
            onAnswer={(action, note) => answer(openRow, action, note)}
            onCopyPlan={() => void copyPlan(openRow)}
          />
        </div>
      </div>
    )
  }

  const banner = noPlanBanner(tally.owedPlan)
  return (
    <div className="view roadmap-pool-view roadmap-project-layout fr-view">
      <div className="roadmap-project-detail">
        <div className="roadmap-pool-modebar">
          <strong className="fr-title">Feature requests</strong>
          <span>
            everything you said, in any review, check or chat · {tally.everything} in all
            {showProject ? ` · ${scopeName}` : ''}
          </span>
          <span className="roadmap-pool-grow" />
          {rows.length > 0 && (
            <button type="button" className="fr-btn" onClick={() => void copyReviewAll()}>
              <ClipboardCopy aria-hidden="true" />
              Review all requests
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="fr-empty">
            <b>No feature requests yet.</b> When you suggest something in a review, a check or a
            chat, the agent files it as a roadmap idea with <code>by: reviewer</code>, and it
            appears here with what became of it.
          </div>
        ) : (
          <>
            <div className="fr-tally">
              {REQUEST_GROUPS.map((group) => (
                <div className={`c ${group}`} key={group}>
                  <b>{tally.groups[group]}</b>
                  <span>{TALLY_LABELS[group]}</span>
                </div>
              ))}
            </div>
            <div className="roadmap-pool-filters">
              <label className="roadmap-pool-search">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder="Filter your suggestions…"
                  aria-label="Filter your suggestions"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {FILTERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`roadmap-pool-filter${filter === id ? ' on' : ''}`}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label} <span>{id === 'everything' ? tally.everything : tally.groups[id]}</span>
                </button>
              ))}
            </div>
            {banner && (
              <div className="fr-owed" role="status">
                <CircleAlert aria-hidden="true" />
                <span className="grow">
                  <b>{banner}</b> You said {tally.owedPlan === 1 ? 'it' : 'them'}, and no plan or
                  fate was recorded.
                </span>
                <button type="button" onClick={() => setOnlyNoPlan((on) => !on)}>
                  {onlyNoPlan ? 'Show all' : 'Show only these'}
                </button>
              </div>
            )}
            {groups.length === 0 ? (
              <div className="fr-empty">Nothing matches that filter.</div>
            ) : (
              <div className="roadmap-pool-scroll" role="list" aria-label="Feature requests">
                {groups.map((group) => {
                  const folded = group.foldable && !finishedShown
                  return (
                    <section className={`roadmap-lane g-${group.group}`} key={group.group}>
                      <button
                        type="button"
                        className="roadmap-lane-header"
                        aria-expanded={!folded}
                        disabled={group.group === 'finished' && filter === 'finished'}
                        onClick={() => group.foldable && setFinishedOpen((open) => !open)}
                      >
                        <strong>{group.label}</strong>
                        <span>
                          {group.rows.length}
                          {folded ? ' – folded' : ''}
                        </span>
                        <span className="roadmap-pool-grow" />
                        <span className="sub">{group.sub}</span>
                        {folded ? <ChevronRight /> : <ChevronDown />}
                      </button>
                      {!folded &&
                        group.rows.map((row) => (
                          <RequestRow
                            key={row.key}
                            row={row}
                            showProject={showProject}
                            focused={active === row.key}
                            onFocus={() => setSelected(row.key)}
                            onOpen={() => setOpenKey(row.key)}
                            onCopyPlan={() => void copyPlan(row)}
                          />
                        ))}
                    </section>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function RequestRow({
  row,
  showProject,
  focused,
  onFocus,
  onOpen,
  onCopyPlan
}: {
  row: FeatureRequestRow
  showProject: boolean
  focused: boolean
  onFocus: () => void
  onOpen: () => void
  onCopyPlan: () => void
}): React.JSX.Element {
  const quote = row.quotes.find((candidate) => candidate.text) ?? row.quotes[0]
  return (
    <div
      className={`fr-row${focused ? ' focused' : ''}`}
      role="listitem"
      data-request-row={row.key}
    >
      <FateChip row={row} />
      <div className="bd">
        <button type="button" className="t" onFocus={onFocus} onClick={onOpen}>
          {showProject && <em>{row.project} · </em>}
          {row.title}
        </button>
        {quote && (quote.text || quote.where) && (
          <span className="q">
            {quote.text && <em>&ldquo;{quote.text}&rdquo;</em>}
            {(quote.where || quote.when) && (
              <span className="where">
                {quote.text ? ' ' : ''}
                {[quote.where, quote.when].filter(Boolean).join(', ')}
              </span>
            )}
          </span>
        )}
        {row.plan ? (
          <span className="pl">
            <b>Plan:</b> {row.plan}
          </span>
        ) : (
          <span className="pl owed">No plan recorded. The agent owes you one.</span>
        )}
      </div>
      <div className="rt">
        {/* Every row opens its card, finished and unplanned ones too (ticket 41);
            it is the primary button on the ones waiting on him. */}
        <button
          type="button"
          className={`fr-btn ${row.owed ? 'first' : 'quiet'}`}
          aria-label={`Open: ${row.title}`}
          onClick={onOpen}
        >
          Open
          <ArrowRight aria-hidden="true" />
        </button>
        {row.group === 'planned' && <span className="rel">on the Roadmap tab</span>}
        {row.group === 'none' && (
          <button type="button" className="fr-btn quiet" onClick={onCopyPlan}>
            <ClipboardCopy aria-hidden="true" />
            Ask an agent to plan this
          </button>
        )}
        {row.answered && row.group === 'waiting' && (
          <span className="rel">You answered: {row.answered.answer}</span>
        )}
        {row.related.length > 0 && (
          <span className="rel">
            <Link2 aria-hidden="true" />
            {row.related.length} related
          </span>
        )}
      </div>
    </div>
  )
}
