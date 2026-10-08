import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Clock,
  Inbox as InboxIcon,
  Search
} from 'lucide-react'
import { useApp } from '../state/app'
import { useCommandScope } from '../commands/provider'
import { archivedRows, runRequestKey } from '../lib/inbox'
import { formatDenseAge } from '../lib/dateVocabulary'
import { projectDisplayName } from '../lib/projectStanding'
import {
  FLEET_INBOX_FILTER_LABELS,
  FLEET_INBOX_SORT_LABELS,
  FLEET_INBOX_SORT_STORAGE_KEY,
  countInWords,
  fleetInbox,
  readFleetInboxSort,
  writeFleetSort,
  type FleetInboxFilter,
  type FleetInboxSort
} from '../lib/fleet'
import { ALL_PROJECTS } from '../../../shared/windowScope'
import { NothingYetInbox } from '../components/NothingYet'
import { nothingFiledYet } from '../lib/getStarted'

const FILTERS = Object.keys(FLEET_INBOX_FILTER_LABELS) as FleetInboxFilter[]
const SORTS = Object.keys(FLEET_INBOX_SORT_LABELS) as FleetInboxSort[]

/**
 * Inbox under *All projects* — cross-project triage. Every
 * request still open anywhere, newest first unless the reviewer says otherwise. The
 * project is the first thing each row says, because under this scope it is
 * the one fact the row cannot assume.
 */
export function FleetInbox(): React.JSX.Element {
  const {
    snapshot,
    selectedPath,
    setSelectedPath,
    navigate,
    setScope,
    helpOpen,
    switcherOpen,
    seen,
    seenLoaded,
    archived,
    archiveRequest,
    unarchiveRequest
  } = useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FleetInboxFilter>('everything')
  const [sort, setSortValue] = useState<FleetInboxSort>(() => readFleetInboxSort())
  const [showArchived, setShowArchived] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const model = useMemo(
    () =>
      snapshot
        ? fleetInbox(snapshot, { seen, archived, seenLoaded }, { query, filter, sort })
        : { rows: [], projectCount: 0, counts: { everything: 0, waiting: 0, building: 0 } },
    [snapshot, seen, archived, seenLoaded, query, filter, sort]
  )
  const archivedList = useMemo(
    () => (snapshot ? archivedRows(snapshot, ALL_PROJECTS, archived) : []),
    [snapshot, archived]
  )

  // Nothing left in the bin returns to the live list, off-frame (the app's
  // lint law: no synchronous setState in an effect body).
  useEffect(() => {
    if (!showArchived || archivedList.length > 0) return
    const id = requestAnimationFrame(() => setShowArchived(false))
    return () => cancelAnimationFrame(id)
  }, [showArchived, archivedList.length])

  const paths = useMemo(
    () =>
      showArchived
        ? archivedList.map((row) => row.run.request.path)
        : model.rows.map((row) => row.path),
    [showArchived, archivedList, model.rows]
  )
  const activePath =
    selectedPath && paths.includes(selectedPath) ? selectedPath : (paths[0] ?? null)
  const activeIndex = activePath ? paths.indexOf(activePath) : -1
  const activeRow = showArchived ? undefined : model.rows[activeIndex]
  const activeArchived = showArchived ? archivedList[activeIndex] : undefined
  const root = snapshot?.root ?? ''

  const setSort = (next: FleetInboxSort): void => {
    setSortValue(next)
    writeFleetSort(FLEET_INBOX_SORT_STORAGE_KEY, next)
  }
  const open = (path: string): void => {
    setSelectedPath(path)
    navigate({ kind: 'runner', path })
  }

  const commandEnabled = !helpOpen && !switcherOpen
  useCommandScope({
    'nav.move-down': {
      enabled: commandEnabled && paths.length > 0,
      handler: () => setSelectedPath(paths[Math.min(activeIndex + 1, paths.length - 1)] ?? null)
    },
    'nav.move-up': {
      enabled: commandEnabled && paths.length > 0,
      handler: () => setSelectedPath(paths[Math.max(activeIndex - 1, 0)] ?? null)
    },
    'nav.open-selection': {
      enabled: commandEnabled && !!activePath,
      handler: () => activePath && open(activePath)
    },
    'nav.open-project': {
      enabled: commandEnabled && !!activeRow,
      handler: () => activeRow && setScope({ kind: 'project', slug: activeRow.slug })
    },
    'nav.archive-selection': {
      enabled: commandEnabled && !!activeRow,
      handler: () => activeRow && archiveRequest(runRequestKey(root, activeRow.run))
    },
    'nav.unarchive-selection': {
      enabled: commandEnabled && !!activeArchived,
      handler: () => activeArchived && unarchiveRequest(runRequestKey(root, activeArchived.run))
    },
    'nav.toggle-archived': () => setShowArchived((value) => !value)
  })

  // A records folder no agent has written to yet points to Get started.
  if (nothingFiledYet(snapshot)) return <NothingYetInbox />

  return (
    <div className="view fleet">
      <div className="fleet-bar">
        <div className="fleet-search">
          <Search className="ic" strokeWidth={2} />
          <input
            value={query}
            placeholder="Search requests"
            aria-label="Search requests"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={`fleet-chip${filter === option && !showArchived ? ' on' : ''}`}
            aria-pressed={filter === option && !showArchived}
            onClick={() => {
              setShowArchived(false)
              setFilter(option)
            }}
          >
            {FLEET_INBOX_FILTER_LABELS[option]}
          </button>
        ))}
        <label className="fleet-sort">
          <Clock className="ic" strokeWidth={2} />
          <select
            aria-label="Sort requests"
            value={sort}
            onChange={(event) => setSort(event.target.value as FleetInboxSort)}
          >
            {SORTS.map((option) => (
              <option key={option} value={option}>
                {FLEET_INBOX_SORT_LABELS[option]}
              </option>
            ))}
          </select>
          <ChevronDown className="ic chev" strokeWidth={2} />
        </label>
        <span className="fleet-hint">
          <kbd>↑↓</kbd>move<kbd>↵</kbd>open
        </span>
        {archivedList.length > 0 && (
          <button
            type="button"
            className={`fleet-chip${showArchived ? ' on' : ''}`}
            aria-pressed={showArchived}
            title={showArchived ? 'Back to the inbox' : 'Show archived requests'}
            onClick={() => setShowArchived((value) => !value)}
          >
            <Archive className="ic" strokeWidth={2} />
            Archived {archivedList.length}
          </button>
        )}
      </div>

      <div className="fleet-scroll">
        {showArchived ? (
          <section className="fleet-card" aria-label="Archived requests">
            <header>
              <Archive className="ic" strokeWidth={2} />
              Archived
              <span className="n">hidden from the inbox, never deleted</span>
            </header>
            <div className="fleet-rows">
              {archivedList.map((row) => (
                <div
                  key={row.run.request.path}
                  className={`fleet-r${activePath === row.run.request.path ? ' focused' : ''}`}
                >
                  <button type="button" className="t" onClick={() => open(row.run.request.path)}>
                    <em>{projectDisplayName(snapshot?.releases, row.run.project)}</em> ·{' '}
                    {row.run.request.title}
                  </button>
                  <span className="rr">
                    <span className="age">{formatDenseAge(row.ageSource, now)}</span>
                    <button
                      type="button"
                      className="fleet-chip"
                      onClick={() => unarchiveRequest(runRequestKey(root, row.run))}
                    >
                      <ArchiveRestore className="ic" strokeWidth={2} />
                      Restore
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="fleet-card" aria-label="Open requests">
            <header>
              <InboxIcon className="ic" strokeWidth={2} />
              Open across {countInWords(model.projectCount, 'project')}
              <span className="n">
                {model.rows.length} request{model.rows.length === 1 ? '' : 's'}
              </span>
            </header>
            {model.rows.length === 0 ? (
              <div className="rowempty">
                {model.counts.everything === 0
                  ? 'Nothing waiting from your agents.'
                  : 'Nothing matches.'}
              </div>
            ) : (
              <div className="fleet-rows">
                {model.rows.map((row) => (
                  <button
                    key={row.path}
                    type="button"
                    data-fleet-request={row.path}
                    className={`fleet-r${activePath === row.path ? ' focused' : ''}${row.isNew ? ' fresh' : ''}`}
                    onFocus={() => setSelectedPath(row.path)}
                    onClick={() => open(row.path)}
                  >
                    <span className="t">
                      <em>{row.name}</em> · {row.title}
                    </span>
                    <span className="rr">
                      {row.isNew && <span className="rnew">New</span>}
                      <span
                        className={`fleet-pill ${row.state === 'waiting' ? 'you' : 'building'}`}
                      >
                        {FLEET_INBOX_FILTER_LABELS[row.state]}
                      </span>
                      <span className="age">{formatDenseAge(row.at, now)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
