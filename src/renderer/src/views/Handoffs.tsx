import { useCallback, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Check, Copy, FolderOpen, Search } from 'lucide-react'
import type { Handoff } from '../../../main/qa/handoffs'
import { formatDenseAge } from '../lib/dateVocabulary'
import { readHandoffGrouping, selectHandoffs, writeHandoffGrouping } from '../lib/handoffSelection'
import type { HandoffGrouping, HandoffMoveFilter, HandoffSection } from '../lib/handoffSelection'
import { useApp } from '../state/app'
import { tildePath } from '../../../shared/tildePath'
import { ReadOnlyMarkdown } from './Reading'
import { useCommandScope } from '../commands/provider'

const FILTERS: Array<{ id: HandoffMoveFilter; label: string; tone?: string }> = [
  { id: 'all', label: 'All' },
  { id: 'agent', label: 'Ready for an agent', tone: 'status-ready' },
  { id: 'me', label: 'Waiting on you', tone: 'status-waiting' },
  { id: 'superseded', label: 'Superseded', tone: 'status-inactive' }
]

function isArchived(handoff: Handoff): boolean {
  return handoff.history.kind === 'archived'
}

function isSuperseded(handoff: Handoff): boolean {
  return handoff.state === 'superseded'
}

function isDone(handoff: Handoff): boolean {
  return handoff.state === 'done'
}

function isInactive(handoff: Handoff): boolean {
  return isSuperseded(handoff) || isDone(handoff)
}

function updatedLabel(iso: string, now: Date): string {
  const age = formatDenseAge(iso, now)
  return age ? `updated ${age}` : 'update time unknown'
}

function historyLabel(handoff: Handoff, now: Date): string {
  if (handoff.history.kind === 'never-picked-up') return 'never picked up'
  const age = formatDenseAge(handoff.history.at, now)
  const when = age || 'at an unknown time'
  return handoff.history.kind === 'archived' ? `archived ${when}` : `picked up ${when}`
}

function historyTone(handoff: Handoff): string {
  if (handoff.history.kind === 'archived') return 'status-inactive'
  if (handoff.history.kind === 'picked-up') return 'status-progress'
  return 'status-inactive'
}

function moveLabel(handoff: Handoff): string | null {
  if (isArchived(handoff) || isInactive(handoff)) return null
  if (handoff.move === 'agent') return 'Ready for an agent'
  if (handoff.move === 'me') return 'Waiting on you'
  return null
}

function HandoffRow({
  handoff,
  selected,
  now,
  copied,
  busy,
  onSelect,
  onCopy,
  onArchive
}: {
  handoff: Handoff
  selected: boolean
  now: Date
  copied: boolean
  busy: boolean
  onSelect: (path: string) => void
  onCopy: (handoff: Handoff) => void
  onArchive: (handoff: Handoff) => void
}): React.JSX.Element {
  const move = moveLabel(handoff)
  const superseded = isSuperseded(handoff)
  const done = isDone(handoff)
  const archived = isArchived(handoff)
  return (
    <div
      className={`ho-row${selected ? ' on' : ''}${handoff.stale ? ' stale' : ''}${
        superseded || done || archived ? ' receded' : ''
      }`}
    >
      <button
        type="button"
        className="ho-row-open"
        aria-label={`Open ${handoff.title}`}
        aria-pressed={selected}
        onClick={() => onSelect(handoff.path)}
      >
        <span
          className={`ho-spine${
            superseded || done || archived ? '' : handoff.move === 'agent' ? ' agent' : ' me'
          }`}
          aria-hidden="true"
        />
        <span className="ho-row-body">
          <span className="ho-row-title">{handoff.title}</span>
          <span className="ho-row-meta">
            {superseded ? (
              <span className="ho-marker status-chip status-inactive">superseded</span>
            ) : done ? (
              <span className="ho-marker status-chip status-ready">done</span>
            ) : (
              move && (
                <span
                  className={`ho-move ${handoff.move} status-chip status-${
                    handoff.move === 'agent' ? 'ready' : 'waiting'
                  }`}
                >
                  {move}
                </span>
              )
            )}
            <span>{updatedLabel(handoff.updated, now)}</span>
            <span
              className={`ho-history ${handoff.history.kind} status-chip ${historyTone(handoff)}`}
            >
              {historyLabel(handoff, now)}
            </span>
          </span>
        </span>
      </button>
      <div className="ho-row-actions">
        <button
          type="button"
          className="ho-row-copy"
          aria-label={`Copy ${handoff.title} prompt`}
          disabled={busy}
          onClick={() => onCopy(handoff)}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button
          type="button"
          className="ho-row-archive"
          aria-label={`${archived ? 'Restore' : 'Archive'} ${handoff.title} handoff`}
          disabled={busy}
          onClick={() => onArchive(handoff)}
        >
          {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
          <span>{archived ? 'Restore' : 'Archive'}</span>
        </button>
      </div>
    </div>
  )
}

function HandoffList({
  sections,
  selectedPath,
  now,
  copiedPath,
  busyPath,
  onSelect,
  onCopy,
  onArchive
}: {
  sections: HandoffSection[]
  selectedPath: string | null
  now: Date
  copiedPath: string | null
  busyPath: string | null
  onSelect: (path: string) => void
  onCopy: (handoff: Handoff) => void
  onArchive: (handoff: Handoff) => void
}): React.JSX.Element {
  return (
    <div className="ho-list" aria-label="Handoffs">
      {sections.map((section) => (
        <section key={section.project ?? 'newest-first'}>
          {section.project && (
            <div className="ho-group" data-handoff-group={section.project}>
              <span>{section.project}</span>
              <span>{section.handoffs.length}</span>
            </div>
          )}
          {section.handoffs.map((handoff) => (
            <HandoffRow
              key={handoff.path}
              handoff={handoff}
              selected={handoff.path === selectedPath}
              now={now}
              copied={handoff.path === copiedPath}
              busy={handoff.path === busyPath}
              onSelect={onSelect}
              onCopy={onCopy}
              onArchive={onArchive}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function HandoffDocument({
  handoff,
  now,
  copied,
  busy,
  onCopy,
  onArchive,
  onReveal,
  onBack
}: {
  handoff: Handoff
  now: Date
  copied: boolean
  busy: boolean
  onCopy: () => void
  onArchive: () => void
  onReveal: () => void
  onBack: () => void
}): React.JSX.Element {
  const move = moveLabel(handoff)
  const archived = isArchived(handoff)
  const superseded = isSuperseded(handoff)
  const done = isDone(handoff)
  const documentMarkdown = handoff.bodyMarkdown.replace(/^\s*#\s+[^\n]+\n?/, '')

  return (
    <article className="ho-document-pane">
      <header className="ho-document-head">
        <button type="button" className="ho-back" aria-label="Back to handoffs" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Handoffs
        </button>
        <h2>{handoff.title}</h2>
        <div className="ho-document-meta">
          {move && (
            <strong
              className={`${handoff.move} status-chip status-${
                handoff.move === 'agent' ? 'ready' : 'waiting'
              }`}
            >
              {move}
            </strong>
          )}
          <span>{handoff.project}</span>
          <span>{updatedLabel(handoff.updated, now)}</span>
          {superseded && <span className="ho-marker status-chip status-inactive">superseded</span>}
          {done && <span className="ho-marker status-chip status-ready">done</span>}
          {!handoff.repo && <span className="ho-marker warning">no repo recorded</span>}
        </div>
        <div className="ho-document-path">{handoff.path}</div>
      </header>

      {superseded && (
        <div className="ho-notice status-notice status-inactive">
          <strong>An agent marked this handoff superseded.</strong> It remains readable because its
          reasoning is still part of the record.
        </div>
      )}

      <section className="ho-resume" aria-label="Start an agent on this handoff">
        <div className="ho-eyebrow">Start an agent on this</div>
        <p>
          {handoff.resume ??
            'This file declares no resume line. The first section of the handoff is where the next agent starts.'}
        </p>
        <div className="ho-prompt-actions">
          <pre>{handoff.relaunchPrompt}</pre>
          <button type="button" className="ho-primary" aria-label="Copy prompt" onClick={onCopy}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" aria-label="Show handoff file" onClick={onReveal}>
            <FolderOpen aria-hidden="true" />
            Show file
          </button>
          <button
            type="button"
            aria-label={archived ? 'Restore handoff' : 'Archive handoff'}
            disabled={busy}
            onClick={onArchive}
          >
            {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
            {archived ? 'Restore' : 'Archive'}
          </button>
        </div>
        <div className={`ho-picked status-chip ${historyTone(handoff)}`}>
          {historyLabel(handoff, now)}
        </div>
        {!handoff.repo && (
          <div className="ho-repo-warning">
            <strong>No repository is recorded in this file.</strong> The prompt still points at the
            handoff instead of guessing where the work lives.
          </div>
        )}
      </section>

      <ReadOnlyMarkdown path={handoff.path} markdown={documentMarkdown} />
    </article>
  )
}

export function Handoffs(): React.JSX.Element {
  // The project shown is the window's scope; *All projects* shows every
  // handoff. This surface no longer keeps a project of its own (ADR-0016 § 1).
  const { snapshot, helpOpen, switcherOpen, showToast, scope, setScope, view } = useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<HandoffMoveFilter>('all')
  const [grouping, setGrouping] = useState<HandoffGrouping>(readHandoffGrouping)
  const project = scope.kind === 'project' ? scope.slug : null
  // A link to a handoff opens with that handoff selected (2026-09-26).
  const [selectedPath, setSelectedPath] = useState<string | null>(
    view?.kind === 'handoffs' ? (view.path ?? null) : null
  )
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [openedAt] = useState(() => new Date())
  const projectPickerRef = useRef<HTMLSelectElement>(null)
  const now = snapshot ? new Date(snapshot.scannedAt) : openedAt

  const selection = useMemo(
    () =>
      selectHandoffs(snapshot?.handoffs ?? [], {
        grouping,
        project,
        move: filter,
        query
      }),
    [filter, grouping, project, query, snapshot]
  )
  const { counts, projects, sections, visible } = selection
  const handoffs = snapshot?.handoffs ?? []

  const changeGrouping = useCallback((next: HandoffGrouping) => {
    setGrouping(next)
    writeHandoffGrouping(next)
  }, [])

  const changeProject = useCallback(
    (next: string | null) => {
      setScope(next ? { kind: 'project', slug: next } : { kind: 'all' })
    },
    [setScope]
  )

  const selected = visible.find((handoff) => handoff.path === selectedPath) ?? visible[0] ?? null

  const copy = useCallback(
    async (handoff: Handoff) => {
      setBusyPath(handoff.path)
      try {
        // Main refuses a path outside the scanned record with null.
        const state = await window.qa.copyHandoffPrompt(handoff.path)
        if (!state) {
          showToast('Could not copy the prompt')
          return
        }
        setCopiedPath(handoff.path)
        showToast('Prompt copied · marked picked up')
      } catch {
        showToast('Could not copy the prompt')
      } finally {
        setBusyPath(null)
      }
    },
    [showToast]
  )

  const archive = useCallback(
    async (handoff: Handoff) => {
      setBusyPath(handoff.path)
      // Ticket 22: an archived handoff restores from the same button.
      const restoring = isArchived(handoff)
      try {
        const state = restoring
          ? await window.qa.unarchiveHandoff(handoff.path)
          : await window.qa.archiveHandoff(handoff.path)
        if (!state) {
          showToast(restoring ? 'Could not restore the handoff' : 'Could not archive the handoff')
          return
        }
        showToast(
          restoring
            ? 'Handoff restored · it counts as ready again'
            : 'Handoff archived · the document is unchanged'
        )
      } catch {
        showToast(restoring ? 'Could not restore the handoff' : 'Could not archive the handoff')
      } finally {
        setBusyPath(null)
      }
    },
    [showToast]
  )

  const reveal = useCallback(
    async (handoff: Handoff) => {
      try {
        // false: main refused a path that is not a scanned handoff.
        if (!(await window.qa.revealHandoff(handoff.path))) {
          showToast('Could not show the handoff file')
        }
      } catch {
        showToast('Could not show the handoff file')
      }
    },
    [showToast]
  )

  const commandEnabled = !helpOpen && !switcherOpen
  const currentIndex = selected
    ? visible.findIndex((handoff) => handoff.path === selected.path)
    : -1
  useCommandScope({
    'nav.move-down': {
      enabled: commandEnabled && visible.length > 0,
      handler: () => {
        const next = visible[Math.min(currentIndex + 1, visible.length - 1)]
        if (next) setSelectedPath(next.path)
      }
    },
    'nav.move-up': {
      enabled: commandEnabled && visible.length > 0,
      handler: () => {
        const next = visible[Math.max(currentIndex - 1, 0)]
        if (next) setSelectedPath(next.path)
      }
    },
    'nav.open-selection': {
      enabled: commandEnabled && !!selected,
      handler: () => selected && setSelectedPath(selected.path)
    },
    'app.close-back': {
      enabled: commandEnabled && !!selectedPath,
      priority: 20,
      handler: () => setSelectedPath(null)
    },
    'handoff.copy': {
      enabled: commandEnabled && !!selected,
      handler: () => selected && void copy(selected)
    },
    'handoff.archive': {
      enabled: commandEnabled && !!selected && !isArchived(selected),
      handler: () => selected && void archive(selected)
    },
    'handoff.reveal': {
      enabled: commandEnabled && !!selected,
      handler: () => selected && void reveal(selected)
    },
    'handoff.filter-all': () => setFilter('all'),
    'handoff.filter-ready': () => setFilter('agent'),
    'handoff.filter-waiting': () => setFilter('me'),
    'handoff.filter-superseded': () => setFilter('superseded'),
    'handoff.toggle-grouping': () => changeGrouping(grouping === 'flat' ? 'project' : 'flat'),
    'handoff.filter-project': () => projectPickerRef.current?.focus()
  })

  if (snapshot?.rootMissing) {
    return (
      <div className="view ho-view">
        {/* No heading: the tab bar above names this surface (ticket 14). The
            modebar held nothing else here, and an empty one is a band of
            padding and a 2px rule across the top of the surface. */}
        <div className="empty">
          <p>
            Record folder not found at {snapshot.root}. Open Settings to point Dev Traffic Control
            at it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`view ho-view${selectedPath ? ' ho-detail-open' : ''}`}>
      {/* The surface is named by its tab, not again here (ticket 14). What is
          left in this bar is the standing count, which the tab does not say — so
          the bar is drawn only when there is a count to put in it. */}
      {handoffs.length > 0 && (
        <div className="modebar">
          <span
            className="ho-counts"
            aria-label={`${counts.all} total, ${counts.agent} ready for an agent, ${counts.me} waiting on you, ${counts.superseded} superseded`}
          >
            <span className="ho-count-unit">{counts.all} total</span>
            <span className="ho-count-unit">
              <span className="status-chip status-ready">{counts.agent} ready for an agent</span>
            </span>
            <span className="ho-count-unit">
              <span className="status-chip status-waiting">{counts.me} waiting on you</span>
            </span>
            <span className="ho-count-unit">
              <span className="status-chip status-inactive">{counts.superseded} superseded</span>
            </span>
          </span>
        </div>
      )}

      {handoffs.length === 0 ? (
        <div className="ho-blank">
          <div>
            <h2>Nothing to pick up.</h2>
            <code>
              {tildePath(snapshot?.root ?? '~/Documents/Dev Traffic Control')}
              /&lt;project&gt;/handoffs/
            </code>
            <p>
              No project has a handoffs folder yet. An agent creates one when it leaves a stopped
              thread, and it appears here on its own.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="ho-filters">
            <label className="ho-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Search handoffs"
                aria-label="Search handoffs"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ho-filter-chip ${filter === item.id ? 'on' : ''}${item.tone ? ` ${item.tone}` : ''}`}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label} <span>{counts[item.id]}</span>
              </button>
            ))}
            <label className="ho-project-filter">
              <select
                ref={projectPickerRef}
                aria-label="Filter handoffs by project"
                value={project ?? ''}
                onChange={(event) => changeProject(event.target.value || null)}
              >
                <option value="">All projects ({handoffs.length})</option>
                {projects.map((item) => (
                  <option key={item.project} value={item.project}>
                    {item.project} ({item.count})
                  </option>
                ))}
              </select>
            </label>
            <div className="ho-grouping" role="group" aria-label="Group handoffs">
              <button
                type="button"
                className={grouping === 'flat' ? 'on' : ''}
                aria-pressed={grouping === 'flat'}
                onClick={() => changeGrouping('flat')}
              >
                Newest first
              </button>
              <button
                type="button"
                className={grouping === 'project' ? 'on' : ''}
                aria-pressed={grouping === 'project'}
                onClick={() => changeGrouping('project')}
              >
                By project
              </button>
            </div>
          </div>
          <div className={`ho-split${selectedPath ? ' detail-open' : ''}`}>
            {visible.length > 0 ? (
              <>
                <HandoffList
                  sections={sections}
                  selectedPath={selected?.path ?? null}
                  now={now}
                  copiedPath={copiedPath}
                  busyPath={busyPath}
                  onSelect={setSelectedPath}
                  onCopy={(handoff) => void copy(handoff)}
                  onArchive={(handoff) => void archive(handoff)}
                />
                {selected && (
                  <HandoffDocument
                    handoff={selected}
                    now={now}
                    copied={copiedPath === selected.path}
                    busy={busyPath === selected.path}
                    onCopy={() => void copy(selected)}
                    onArchive={() => void archive(selected)}
                    onReveal={() => void reveal(selected)}
                    onBack={() => setSelectedPath(null)}
                  />
                )}
              </>
            ) : (
              <div className="ho-no-results">
                <h2>No handoffs match.</h2>
                <p>Change the search or filter to bring the list back.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
