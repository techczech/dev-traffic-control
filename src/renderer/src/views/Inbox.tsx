import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  ChevronRight,
  FolderOpen,
  Inbox as InboxIcon,
  SquarePen,
  TriangleAlert
} from 'lucide-react'
import { useApp } from '../state/app'
import { archivedRows, inboxCounts, inboxRows, miniSpineCells, runRequestKey } from '../lib/inbox'
import { isReviewRun } from '../lib/format'
import { formatDenseAge } from '../lib/dateVocabulary'
import { runRowState } from '../lib/roadmap'
import { Chips } from '../components/Chips'
import type { InboxRow } from '../lib/inbox'
import { RunRowProgress } from './Dashboard'
import { FleetInbox } from './FleetInbox'
import { NothingYetEmpty } from '../components/NothingYet'
import { nothingFiledYet } from '../lib/getStarted'
import { useCommandScope } from '../commands/provider'
import type { SerializableRun } from '../../../shared/ipc'

/**
 * The Inbox follows the window's scope (ADR-0016 § 1). Under *All projects* it
 * is the fleet's triage list (mockup state 16); in a project, that project's
 * requests. A missing record folder is the same state under either scope.
 */
export function Inbox(): React.JSX.Element {
  const { scope, snapshot } = useApp()
  if (scope.kind === 'all' && !snapshot?.rootMissing) return <FleetInbox />
  return <ProjectInbox />
}

function ProjectInbox(): React.JSX.Element {
  const {
    snapshot,
    selectedPath,
    setSelectedPath,
    navigate,
    openProject,
    reloadSettings,
    helpOpen,
    switcherOpen,
    seen,
    seenLoaded,
    archived,
    archiveRequest,
    unarchiveRequest,
    archivedThreads,
    unarchiveThread,
    scope
  } = useApp()
  const [showArchived, setShowArchived] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // The rows are the window's scope's rows (ADR-0016 § 1): in a project, that
  // project's requests; under *All projects*, every project's.
  const groups = useMemo(
    () => (snapshot ? inboxRows(snapshot, scope, seen, archived, seenLoaded) : []),
    [snapshot, scope, seen, archived, seenLoaded]
  )
  const flatRows = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const paths = useMemo(() => flatRows.map((r) => r.run.request.path), [flatRows])
  const archivedList = useMemo(
    () => (snapshot ? archivedRows(snapshot, scope, archived) : []),
    [snapshot, scope, archived]
  )
  // Decisions archived with Archive old (ticket 22) come back from the same bin.
  const archivedDecisions = useMemo(
    () =>
      (snapshot?.threads ?? []).filter(
        (thread) =>
          archivedThreads?.has(thread.id) &&
          (scope.kind === 'all' || thread.projects.includes(scope.slug))
      ),
    [snapshot, archivedThreads, scope]
  )
  const archivedTotal = archivedList.length + archivedDecisions.length
  const archivedPaths = useMemo(
    () => archivedList.map((row) => row.run.request.path),
    [archivedList]
  )
  const counts = useMemo(
    () =>
      snapshot ? inboxCounts(snapshot, scope, seen, archived, seenLoaded) : { total: 0, fresh: 0 },
    [snapshot, scope, seen, archived, seenLoaded]
  )

  // Nothing left to show in the bin returns us to the live list automatically.
  // Off-frame, never a synchronous setState in an effect body (the app's lint
  // law — a sync setState here cascades renders).
  useEffect(() => {
    if (!showArchived || archivedTotal > 0) return
    const id = requestAnimationFrame(() => setShowArchived(false))
    return () => cancelAnimationFrame(id)
  }, [showArchived, archivedTotal])

  // Re-point the record repo when the current root has stopped resolving.
  const chooseLocation = async (): Promise<void> => {
    const picked = await window.qa.pickFolder()
    if (!picked) return
    setLocationError(null)
    try {
      // null: main refused the folder and wrote nothing.
      if (!(await window.qa.bootstrapRepo(picked))) {
        setLocationError('Could not use that folder. Choose it again, then try again.')
        return
      }
      reloadSettings()
    } catch {
      setLocationError('Could not use that folder. Check that it can be read, then try again.')
    }
  }

  // Selection survives snapshot refresh by run path; default to the first row.
  useEffect(() => {
    const currentPaths = showArchived ? archivedPaths : paths
    if (currentPaths.length === 0) {
      if (selectedPath !== null) setSelectedPath(null)
      return
    }
    if (!selectedPath || !currentPaths.includes(selectedPath)) setSelectedPath(currentPaths[0])
  }, [archivedPaths, paths, selectedPath, setSelectedPath, showArchived])

  const commandEnabled = !helpOpen && !switcherOpen
  const currentPaths = showArchived ? archivedPaths : paths
  const selectedIndex = selectedPath ? currentPaths.indexOf(selectedPath) : -1
  const selectedRow = flatRows[selectedIndex]
  const selectedArchived = archivedList[selectedIndex]
  useCommandScope({
    'nav.move-down': {
      enabled: commandEnabled && currentPaths.length > 0,
      handler: () =>
        setSelectedPath(
          currentPaths[Math.min(selectedIndex + 1, currentPaths.length - 1)] ?? currentPaths[0]
        )
    },
    'nav.move-up': {
      enabled: commandEnabled && currentPaths.length > 0,
      handler: () =>
        setSelectedPath(currentPaths[Math.max(selectedIndex - 1, 0)] ?? currentPaths[0])
    },
    'nav.open-selection': {
      enabled: commandEnabled && !!(showArchived ? selectedArchived : selectedRow),
      handler: () => {
        const row = showArchived ? selectedArchived : selectedRow
        if (row) navigate({ kind: 'runner', path: row.run.request.path })
      }
    },
    'run.open-other-surface': {
      enabled: commandEnabled && !showArchived && selectedRow?.run.request.mode === 'light',
      handler: () =>
        selectedRow &&
        navigate({ kind: 'runner', path: selectedRow.run.request.path, detailed: true })
    },
    'nav.open-project': {
      enabled: commandEnabled && !showArchived && !!selectedRow,
      handler: () => selectedRow && openProject(selectedRow.run.project)
    },
    'nav.archive-selection': {
      enabled: commandEnabled && !showArchived && !!selectedRow,
      handler: () =>
        selectedRow && archiveRequest(runRequestKey(snapshot?.root ?? '', selectedRow.run))
    },
    'nav.unarchive-selection': {
      enabled: commandEnabled && showArchived && !!selectedArchived,
      handler: () =>
        selectedArchived &&
        unarchiveRequest(runRequestKey(snapshot?.root ?? '', selectedArchived.run))
    },
    'nav.choose-record-folder': () => void chooseLocation(),
    'nav.toggle-archived': () => setShowArchived((value) => !value)
  })

  const archiveToggle = archivedTotal > 0 && (
    <button
      className={`ghostbtn${showArchived ? ' on' : ''}`}
      aria-pressed={showArchived}
      title={showArchived ? 'Back to the inbox' : 'Show archived requests'}
      onClick={() => setShowArchived((v) => !v)}
    >
      <Archive className="ic" strokeWidth={2} />
      Archived {archivedTotal}
    </button>
  )

  if (snapshot?.rootMissing) {
    return (
      <div className="view">
        <div className="vhead">
          <InboxIcon className="ic l" strokeWidth={2} />
          <span className="vt">Inbox</span>
          <span className="grow" />
        </div>
        <div className="banner" role="alert">
          <TriangleAlert className="ic" strokeWidth={2} />
          <span className="grow">Record folder not found at {snapshot.root}</span>
        </div>
        <div className="empty">
          <p>Dev Traffic Control reads and writes one folder — pick where it lives.</p>
          {locationError && <p role="alert">{locationError}</p>}
          <button className="secbtn" onClick={() => void chooseLocation()}>
            <FolderOpen className="ic" strokeWidth={2} />
            Choose location…
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <div className="vhead">
        <InboxIcon className="ic l" strokeWidth={2} />
        <span className="vt">{showArchived ? 'Archived' : 'Inbox'}</span>
        {!showArchived && counts.total > 0 && (
          <span className="count-pill status-chip status-waiting">
            {counts.total} waiting{counts.fresh > 0 ? ` · ${counts.fresh} new` : ''}
          </span>
        )}
        <span className="grow" />
        {archiveToggle}
        {!showArchived && (
          <button className="ghostbtn" disabled title="Open a project or a run to write a note">
            <SquarePen className="ic" strokeWidth={2} />
            New note
          </button>
        )}
      </div>

      {showArchived ? (
        <div className="scroll">
          <p className="archnote">
            Archived requests are hidden from the inbox but never deleted — the files stay in the
            record folder. Restore any of them here.
          </p>
          {archivedList.map((row) => (
            <ArchivedRow
              key={row.run.request.path}
              row={row}
              now={now}
              selected={selectedPath === row.run.request.path}
              onRestore={() => {
                setSelectedPath(row.run.request.path)
                unarchiveRequest(runRequestKey(snapshot?.root ?? '', row.run))
              }}
              onOpen={() => {
                setSelectedPath(row.run.request.path)
                navigate({ kind: 'runner', path: row.run.request.path })
              }}
            />
          ))}
          {archivedDecisions.length > 0 && (
            <section className="archived-decisions" aria-label="Archived decisions">
              <p className="archnote">
                Archived decisions no longer count as owed. The threads themselves are untouched.
              </p>
              {archivedDecisions.map((thread) => (
                <div className="archived-decision" key={thread.id}>
                  <span className="t">{thread.title}</span>
                  <button
                    type="button"
                    className="ghostbtn"
                    onClick={() => unarchiveThread(thread.id)}
                  >
                    <ArchiveRestore className="ic" strokeWidth={2} />
                    Restore
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      ) : counts.total === 0 && nothingFiledYet(snapshot) ? (
        <NothingYetEmpty />
      ) : counts.total === 0 ? (
        <div className="empty">
          <div className="motif" aria-hidden="true">
            <i />
            <i />
            <i />
            <BadgeCheck className="ic" strokeWidth={2} />
          </div>
          <h2>Inbox clear</h2>
          <p>Nothing waiting from your agents.</p>
          <button className="secbtn" disabled title="Open a project or a run to write a note">
            <SquarePen className="ic" strokeWidth={2} />
            Write a note
          </button>
        </div>
      ) : (
        <div className="scroll">
          {groups.map((group) => (
            <div className="pgroup" key={group.project}>
              <button className="pghead" onClick={() => openProject(group.project)}>
                <span className="pname">{group.project}</span>
                <ChevronRight className="ic s" strokeWidth={2} />
                <span className="pcount">
                  {group.rows.length} request{group.rows.length > 1 ? 's' : ''}
                </span>
              </button>
              {group.rows.map((row) => (
                <RequestRow
                  key={row.run.request.path}
                  row={row}
                  now={now}
                  selected={selectedPath === row.run.request.path}
                  seen={seen}
                  seenLoaded={seenLoaded}
                  identityContext={{ root: snapshot?.root ?? '', runs: snapshot?.runs ?? [] }}
                  onSelect={() => setSelectedPath(row.run.request.path)}
                  onOpen={() => navigate({ kind: 'runner', path: row.run.request.path })}
                  onArchive={() => archiveRequest(runRequestKey(snapshot?.root ?? '', row.run))}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RequestRow({
  row,
  now,
  selected,
  seen,
  seenLoaded,
  identityContext,
  onSelect,
  onOpen,
  onArchive
}: {
  row: InboxRow
  now: Date
  selected: boolean
  seen: ReadonlySet<string>
  seenLoaded: boolean
  identityContext: { root: string; runs: readonly SerializableRun[] }
  onSelect: () => void
  onOpen: () => void
  onArchive: () => void
}): React.JSX.Element {
  const { run, ageSource, isNew } = row
  const degraded = run.request.degraded
  const cells = miniSpineCells(run)
  return (
    <button
      className={`reqrow${selected ? ' sel' : ''}${degraded ? ' degraded' : ''}${isNew ? ' fresh' : ''}`}
      onClick={() => {
        onSelect()
        onOpen()
      }}
    >
      <span className="r1">
        {isNew && <span className="rnew">New</span>}
        <span className="rtitle">{run.request.title}</span>
        <span className="age mono">{formatDenseAge(ageSource, now)}</span>
        <span
          className="rarch"
          aria-label="Archive this request"
          title="Archive (E)"
          onClick={(e) => {
            e.stopPropagation()
            onArchive()
          }}
        >
          <Archive className="ic s" strokeWidth={2} />
        </span>
      </span>
      <span className="r2">
        <Chips run={run} />
        {degraded && (
          <span className="chip warn" title="Opens as a plain read-only view">
            unparsed
          </span>
        )}
        {run.reportError && (
          <span className="chip warn" title={run.reportError}>
            report unreadable
          </span>
        )}
        {/* Mockup shows the filename here — file truth in chrome (ADR-0006 rule 5). */}
        <span className="rid mono">{run.request.path.split('/').pop()?.replace(/\.md$/, '')}</span>
      </span>
      <span className="r3">
        <RunRowProgress
          typeLabel={isReviewRun(run) ? 'Document review' : 'Test request'}
          state={runRowState(run, seen, seenLoaded, identityContext)}
          cells={cells}
          now={now}
        />
      </span>
    </button>
  )
}

function ArchivedRow({
  row,
  now,
  selected,
  onRestore,
  onOpen
}: {
  row: InboxRow
  now: Date
  selected: boolean
  onRestore: () => void
  onOpen: () => void
}): React.JSX.Element {
  const { run, ageSource } = row
  return (
    <div className={`reqrow arch${selected ? ' sel' : ''}`}>
      <button className="reqmain" onClick={onOpen}>
        <span className="r1">
          <span className="rtitle">{run.request.title}</span>
          <span className="age mono">{formatDenseAge(ageSource, now)}</span>
        </span>
        <span className="r2">
          <span className="status-chip status-inactive">Archived</span>
          <Chips run={run} />
          <span className="rid mono">
            {run.request.path.split('/').pop()?.replace(/\.md$/, '')}
          </span>
        </span>
      </button>
      <button className="restorebtn" onClick={onRestore}>
        <ArchiveRestore className="ic s" strokeWidth={2} />
        Restore
      </button>
    </div>
  )
}
