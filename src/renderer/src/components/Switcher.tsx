import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, Layers, Search, SquarePen } from 'lucide-react'
import { useApp } from '../state/app'
import { switcherEntries, filterEntries } from '../lib/switcher'
import { miniSpineCells, runRequestKey } from '../lib/inbox'
import { isReviewRun } from '../lib/format'
import { MiniSpine } from './MiniSpine'
import type { SwitcherEntry } from '../lib/switcher'
import type { WindowScope } from '../../../shared/windowScope'
import { useCommandScope } from '../commands/provider'

/** The ⌘K switcher: a filtered flat list of projects, runs and notes. Choosing
 *  a project — or *All projects*, which sits in the same list — sets the
 *  window's scope rather than pushing a view, and the scope the window is
 *  already on is marked rather than hidden. In link mode (the Note editor's
 *  "Link a run…") it shows runs only and returns the chosen run to a callback
 *  instead of navigating. */
export function Switcher(): React.JSX.Element | null {
  const {
    switcherOpen,
    setSwitcherOpen,
    switcherMode,
    pickSwitcherLink,
    snapshot,
    navigate,
    markSeen,
    scope,
    setScope
  } = useApp()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const linkMode = switcherMode === 'link'
  const entries = useMemo(() => {
    if (!snapshot) return []
    const all = switcherEntries(snapshot)
    return linkMode ? all.filter((e) => e.kind === 'run') : all
  }, [snapshot, linkMode])
  const filtered = useMemo(() => filterEntries(entries, query), [entries, query])

  useEffect(() => {
    if (!switcherOpen) return
    const frame = requestAnimationFrame(() => {
      setQuery('')
      setActive(0)
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [switcherOpen])

  const clamped = Math.min(active, Math.max(0, filtered.length - 1))

  function close(): void {
    setQuery('')
    setActive(0)
    setSwitcherOpen(false)
  }

  function go(entry: SwitcherEntry | undefined): void {
    if (!entry) return
    if (linkMode) {
      if (entry.kind === 'run') pickSwitcherLink(entry.run)
      return
    }
    close()
    if (entry.kind === 'all') setScope({ kind: 'all' })
    else if (entry.kind === 'project') setScope({ kind: 'project', slug: entry.slug })
    else if (entry.kind === 'run') {
      markSeen(runRequestKey(snapshot?.root ?? '', entry.run))
      navigate({ kind: 'runner', path: entry.run.request.path })
    } else navigate({ kind: 'note', path: entry.note.path })
  }

  useCommandScope(
    switcherOpen
      ? {
          'palette.move-down': {
            priority: 90,
            handler: () => filtered.length && setActive((clamped + 1) % filtered.length)
          },
          'palette.move-up': {
            priority: 90,
            handler: () =>
              filtered.length && setActive((clamped - 1 + filtered.length) % filtered.length)
          },
          'palette.run': { priority: 90, handler: () => go(filtered[clamped]) },
          'app.close-back': { priority: 90, handler: close }
        }
      : {}
  )

  if (!switcherOpen) return null

  return (
    <div
      className="overlay top"
      role="dialog"
      aria-modal="true"
      aria-label="Switcher"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="cmdk">
        <div className="ckin">
          <Search className="ic" strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            placeholder={linkMode ? 'Link a run…' : 'Go to a project, run or note…'}
            aria-label={linkMode ? 'Link a run' : 'Go to a project, run or note'}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cklist" role="listbox">
          {filtered.length === 0 ? (
            <div className="ckempty">Nothing matches “{query}”.</div>
          ) : (
            filtered.map((entry, i) => (
              <SwitcherRow
                key={rowKey(entry, i)}
                entry={entry}
                current={isCurrentScope(entry, scope)}
                active={i === clamped}
                onHover={() => setActive(i)}
                onSelect={() => go(entry)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function rowKey(entry: SwitcherEntry, i: number): string {
  if (entry.kind === 'all') return 'scope:all'
  if (entry.kind === 'project') return `p:${entry.slug}`
  if (entry.kind === 'run') return `r:${entry.run.request.path}`
  return `n:${entry.note.path}:${i}`
}

/** Marks the scope the window is already on, so choosing is never guesswork. */
function isCurrentScope(entry: SwitcherEntry, scope: WindowScope): boolean {
  if (entry.kind === 'all') return scope.kind === 'all'
  if (entry.kind === 'project') return scope.kind === 'project' && scope.slug === entry.slug
  return false
}

function SwitcherRow({
  entry,
  active,
  current,
  onHover,
  onSelect
}: {
  entry: SwitcherEntry
  active: boolean
  current: boolean
  onHover: () => void
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      className={`ckrow${active ? ' act' : ''}`}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      {entry.kind === 'all' && (
        <>
          <Layers className="ic s" strokeWidth={2} />
          <span className="cklabel">All projects</span>
          <span className="grow" />
          {current && <span className="ckcurrent">Current</span>}
          <span className="cktype">scope</span>
        </>
      )}
      {entry.kind === 'project' && (
        <>
          <Folder className="ic s" strokeWidth={2} />
          <span className="cklabel mono">{entry.slug}</span>
          <span className="grow" />
          {current && <span className="ckcurrent">Current</span>}
          <span className="cktype">project</span>
        </>
      )}
      {entry.kind === 'run' && (
        <>
          <span className="cklabel">{entry.run.request.title}</span>
          <MiniSpine cells={miniSpineCells(entry.run)} small />
          <span className="grow" />
          <span className="ckproj">{entry.run.project}</span>
          <span className="cktype">{isReviewRun(entry.run) ? 'review' : 'run'}</span>
        </>
      )}
      {entry.kind === 'note' && (
        <>
          <SquarePen className="ic s" strokeWidth={2} />
          <span className="cklabel">{entry.note.title}</span>
          <span className={`badge ${entry.note.status === 'handed-over' ? 'handed' : 'draft'}`}>
            {entry.note.status === 'handed-over' ? 'Handed over' : 'Draft'}
          </span>
          <span className="grow" />
          <span className="cktype">note</span>
        </>
      )}
    </button>
  )
}
