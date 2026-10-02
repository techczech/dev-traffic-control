import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Folder, Layers, Search } from 'lucide-react'
import { useApp } from '../state/app'
import { useCommandScope } from '../commands/provider'
import { projectDisplayName, projectRail } from '../lib/projectStanding'
import type { RailGroup, RailRow } from '../lib/projectStanding'
import type { ProjectListPresentation } from '../lib/railVisibility'
import type { RecordSearchHit } from '../../../shared/ipc'
import { inlinePlain } from '../lib/inlineEmphasis'

/** How many matching records the list shows under the projects. */
const RECORD_HITS = 8

/** A matched line without its Markdown marks: headings, bold, table bars. */
function readableSnippet(snippet: string): string {
  return inlinePlain(snippet.replace(/^[#>\s|*-]+/, '').replace(/\s*\|\s*/g, ' · ')).trim()
}

/** One row per record: a record that matches on several lines is listed once. */
function uniqueByFile(hits: readonly RecordSearchHit[]): RecordSearchHit[] {
  const seen = new Set<string>()
  return hits.filter((hit) => (seen.has(hit.file) ? false : (seen.add(hit.file), true)))
}

const GROUP_TONE: Record<RailGroup, string> = {
  'needs-you': 'needs',
  'ticking-along': 'flight',
  quiet: ''
}

/**
 * Above the surfaces, which register the same navigation commands from zero,
 * and below the overlays. While the rail holds focus the rail owns the arrows.
 */
const RAIL_PRIORITY = 40

/**
 * The project list (ADR-0016 § 2, mockup states 1, 2, 3, 7 and 8). It answers
 * "which projects want me" without a click: *All projects* pinned at the top,
 * then the three groups, each row carrying what its project owes.
 *
 * ONE component, two presentations — the mockup's own words, "the rail is the
 * front page". `rail` sits beside a surface in a wide window; `front-page` is
 * the same list, the same rows, the same order, filling a narrow window, where
 * picking a row pushes into the project. A second component that looked like
 * this one would be two lists that could disagree.
 *
 * The list *marks* the project in scope; the titlebar *names* it. Nothing else
 * on the screen repeats it — drawing the project a third time is the defect the
 * chosen direction was picked to avoid.
 */
export function ProjectRail({
  presentation = 'rail'
}: {
  presentation?: Exclude<ProjectListPresentation, 'pushed-in'>
} = {}): React.JSX.Element {
  const {
    snapshot,
    scope,
    setScope,
    openProjectHome,
    housekeeping,
    focusProject,
    goHome,
    navigate,
    openProject,
    leaveFrontPage
  } = useApp()
  const [query, setQuery] = useState('')
  // Records whose title or text match the box, not just project names
  //.
  const [hits, setHits] = useState<RecordSearchHit[]>([])
  const needle = query.trim()
  useEffect(() => {
    if (needle.length < 2 || !window.qa?.searchRecord) return
    let cancelled = false
    const timer = setTimeout(() => {
      void window.qa
        .searchRecord(needle)
        .then((result) => {
          if (!cancelled) setHits(uniqueByFile(result.hits).slice(0, RECORD_HITS))
        })
        .catch(() => {})
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [needle])
  const shownHits = needle.length < 2 ? [] : hits
  const projectNameFor = (slug: string): string => projectDisplayName(snapshot?.releases, slug)
  const openHit = (hit: RecordSearchHit): void => {
    const search = { file: hit.file, line: hit.line, query: needle }
    leaveFrontPage?.()
    openProject(hit.project)
    if (hit.kind === 'request') navigate({ kind: 'runner', path: hit.file, search })
    else if (hit.kind === 'note') navigate({ kind: 'note', path: hit.file, search })
    else if (hit.thread)
      navigate({ kind: 'thread', project: hit.project, thread: hit.thread, search })
  }
  const [now, setNow] = useState(() => new Date())
  const [holdsFocus, setHoldsFocus] = useState(false)
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const rail = useMemo(
    () => projectRail(snapshot, scope, now, query, housekeeping),
    [snapshot, scope, now, query, housekeeping]
  )

  // Keyboard reach goes through the command layer, never a local key handler:
  // the rows are real buttons, so Tab reaches them and Enter activates them,
  // and while the rail holds focus the navigation commands walk the list.
  function rows(): HTMLButtonElement[] {
    return [
      ...(rootRef.current?.querySelectorAll<HTMLButtonElement>('button[data-rail-row]') ?? [])
    ]
  }
  function move(delta: number): void {
    const buttons = rows()
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      index < 0
        ? delta > 0
          ? 0
          : buttons.length - 1
        : Math.min(buttons.length - 1, Math.max(0, index + delta))
    buttons[next]?.focus()
  }

  useCommandScope(
    holdsFocus
      ? {
          'nav.move-down': { priority: RAIL_PRIORITY, handler: () => move(1) },
          'nav.move-up': { priority: RAIL_PRIORITY, handler: () => move(-1) },
          // Ticket 23: beside a surface, Enter focuses the project (the list
          // goes away); a click only previews it. On the front page Enter
          // picks, as a click does.
          'nav.open-selection': {
            priority: RAIL_PRIORITY,
            handler: () => {
              const active = document.activeElement as HTMLElement | null
              if (presentation === 'rail') {
                const slug = active?.dataset.slug
                if (slug) return focusProject(slug)
                if (active?.classList.contains('allrow')) return goHome()
              }
              active?.click()
            }
          }
        }
      : {}
  )

  return (
    <nav
      className={`project-rail${presentation === 'front-page' ? ' frontpage' : ''}`}
      aria-label="Projects"
      ref={rootRef}
      onFocus={() => setHoldsFocus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHoldsFocus(false)
      }}
    >
      <div className="railtop">
        <div className="search">
          <Search className="ic" strokeWidth={2} />
          <input
            value={query}
            placeholder="Search projects and records"
            aria-label="Filter projects"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="railscroll">
        <button
          type="button"
          data-rail-row
          className={`allrow${rail.all.current ? ' on' : ''}`}
          aria-current={rail.all.current ? 'true' : undefined}
          onClick={() => setScope({ kind: 'all' })}
          onDoubleClick={presentation === 'rail' ? goHome : undefined}
        >
          <Layers className="ic" strokeWidth={2} />
          <span className="nm">All projects</span>
          <span className="ct">{rail.all.waiting} waiting</span>
        </button>
        {rail.sections.map((section) => (
          <div key={section.group} className="rsection">
            <div className="rgrp">{section.label}</div>
            {section.rows.map((row) => (
              <ProjectRow
                key={row.slug}
                row={row}
                // Beside a surface, the row of the project already in scope is
                // the door to its home (mockup state 13). On the narrow front
                // page picking it pushes back in, as any other row does.
                homeDoor={row.current && presentation === 'rail'}
                onSelect={() =>
                  row.current && presentation === 'rail'
                    ? openProjectHome()
                    : setScope({ kind: 'project', slug: row.slug })
                }
                onFocusProject={presentation === 'rail' ? () => focusProject(row.slug) : undefined}
              />
            ))}
          </div>
        ))}
        {shownHits.length > 0 && (
          <div className="rsection railhits" aria-label="Matching records">
            <div className="rgrp">In your records</div>
            {shownHits.map((hit) => (
              <button
                key={hit.file}
                type="button"
                data-rail-row
                className="prow hit"
                title={hit.snippet}
                onClick={() => openHit(hit)}
              >
                {/* Keeps the row's grid: the dot column stays, unlit. */}
                <span className="dot" aria-hidden="true" />
                <span className="pbody">
                  <span className="nm">
                    <span>{hit.title}</span>
                  </span>
                  <span className="sub">
                    {projectNameFor(hit.project)} · {readableSnippet(hit.snippet)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {rail.matched === 0 && shownHits.length === 0 && (
          <div className="railempty">Nothing matches “{query}”.</div>
        )}
      </div>
      <div className="railfoot">
        <Clock className="ic" strokeWidth={2} />
        <span>{rail.synced ? `Synced ${rail.synced}` : 'Not synced yet'}</span>
        <span className="rcount">
          {rail.projectCount} project{rail.projectCount === 1 ? '' : 's'}
        </span>
      </div>
    </nav>
  )
}

function ProjectRow({
  row,
  homeDoor,
  onSelect,
  onFocusProject
}: {
  row: RailRow
  homeDoor: boolean
  onSelect: () => void
  /** Double-click: focus mode on this project (ticket 23). */
  onFocusProject?: () => void
}): React.JSX.Element {
  const tone = GROUP_TONE[row.group]
  const standing = row.owes
    ? `${row.name} — ${row.lead} · ${row.owes}`
    : `${row.name} — ${row.lead}`
  return (
    <button
      type="button"
      data-rail-row
      data-slug={row.slug}
      className={`prow${tone ? ` ${tone}` : ''}${row.current ? ' on' : ''}`}
      aria-current={row.current ? 'true' : undefined}
      title={homeDoor ? `${standing}. Open the project home` : standing}
      onClick={onSelect}
      onDoubleClick={onFocusProject}
    >
      <span className="dot" />
      <span className="pbody">
        <span className="nm">
          <span>{row.name}</span>
          {homeDoor && <Folder className="ic homemark" strokeWidth={2} aria-hidden="true" />}
        </span>
        <span className="sub">
          {row.lead}
          {row.owes && (
            <>
              {' · '}
              <span className="owes">{row.owes}</span>
            </>
          )}
        </span>
      </span>
    </button>
  )
}
