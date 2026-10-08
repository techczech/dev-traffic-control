import { useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ListFilter,
  Move,
  Plus,
  Quote,
  Search
} from 'lucide-react'
import type { ProjectPool } from '../../../main/qa/pool'
import { useCommandScope } from '../commands/provider'
import { RoadmapMoveMenu } from '../components/RoadmapMoveMenu'
import { featureRequestRows } from '../lib/featureRequests'
import {
  ROADMAP_LAYOUTS,
  readStartedPending,
  writeStartedPending,
  type RoadmapLayout
} from '../lib/roadmapLayout'
import {
  moveTargets,
  roadmapView,
  versionCore,
  type RoadmapCard,
  type RoadmapFilter,
  type RoadmapGroup
} from '../lib/roadmapReleases'
import { useApp } from '../state/app'

/**
 * The Roadmap grouped by release, as columns or as a list. Pending is always first and is where approvals land, later
 * releases follow in version order, then Unscheduled. A move rewrites the
 * feature's `candidate` through the existing `roadmap:write-idea` edit; nothing
 * here has a write of its own.
 */

const FILTERS: ReadonlyArray<{ id: RoadmapFilter; label: string }> = [
  { id: 'everything', label: 'Everything' },
  { id: 'you', label: 'From you' },
  { id: 'agent', label: 'From agents' }
]

const SHOWN = 5

export function LayoutSwitch({
  layout,
  onLayout
}: {
  layout: RoadmapLayout
  onLayout: (layout: RoadmapLayout) => void
}): React.JSX.Element {
  return (
    <div className="rr-switch" role="group" aria-label="Roadmap layout">
      {ROADMAP_LAYOUTS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`roadmap-pool-filter${layout === id ? ' on' : ''}`}
          aria-pressed={layout === id}
          onClick={() => onLayout(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function today(): string {
  const now = new Date()
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

function shortTitle(title: string): string {
  return title.length > 30 ? `${title.slice(0, 29).trimEnd()}…` : title
}

export function RoadmapByRelease({
  layout,
  onLayout
}: {
  layout: 'columns' | 'list'
  onLayout: (layout: RoadmapLayout) => void
}): React.JSX.Element {
  const { snapshot, scope, helpOpen, switcherOpen, showToast, navigate } = useApp()
  const project = scope.kind === 'project' ? scope.slug : ''
  const sourcePool = snapshot?.pools.find((pool) => pool.project === project) ?? null
  const release = snapshot?.releases.find((entry) => entry.project === project)
  const [optimistic, setOptimistic] = useState<{ pool: ProjectPool; scan: string | null } | null>(
    null
  )
  const pool =
    optimistic && optimistic.pool.project === project && optimistic.scan === snapshot?.scannedAt
      ? optimistic.pool
      : sourcePool
  const [started, setStarted] = useState(readStartedPending)
  const [startOpen, setStartOpen] = useState(false)
  const [startText, setStartText] = useState('')
  const [filter, setFilter] = useState<RoadmapFilter>('everything')
  const [query, setQuery] = useState('')
  const [shownAll, setShownAll] = useState<Set<string>>(new Set())
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['pending']))
  const [selected, setSelected] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const view = useMemo(
    () => roadmapView(pool, release, { filter, query, started: started[project] }),
    [pool, release, filter, query, started, project]
  )
  const waiting = useMemo(
    () => featureRequestRows(snapshot, scope).filter((row) => row.group === 'waiting').length,
    [snapshot, scope]
  )
  const day = today()

  const folded = (group: RoadmapGroup): boolean =>
    layout === 'list' ? !openGroups.has(group.key) : false
  const visibleCards = (group: RoadmapGroup): RoadmapCard[] =>
    folded(group) ? [] : shownAll.has(group.key) ? group.cards : group.cards.slice(0, SHOWN)
  const flat = view.groups.flatMap((group) => visibleCards(group))
  const active =
    selected && flat.some((card) => card.id === selected) ? selected : (flat[0]?.id ?? null)
  const activeIndex = active ? flat.findIndex((card) => card.id === active) : -1
  const commandsOn = !helpOpen && !switcherOpen && !menuFor

  useCommandScope({
    'nav.move-down': {
      enabled: commandsOn && flat.length > 0,
      handler: () => setSelected(flat[Math.min(activeIndex + 1, flat.length - 1)]?.id ?? null)
    },
    'nav.move-up': {
      enabled: commandsOn && flat.length > 0,
      handler: () => setSelected(flat[Math.max(activeIndex - 1, 0)]?.id ?? null)
    },
    'roadmap.move-to': {
      enabled: commandsOn && !!active,
      handler: () => setMenuFor(active)
    }
  })

  async function moveCard(id: string, candidate: string | null): Promise<void> {
    if (pending || !pool) return
    setMenuFor(null)
    setPending(true)
    try {
      const result = await window.qa.writePoolIdea({ project, action: 'edit', id, candidate })
      setOptimistic({ pool: result.pool, scan: snapshot?.scannedAt ?? null })
      setSelected(id)
      showToast(candidate ? `Moved to ${candidate}.` : 'Moved to Unscheduled.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The feature could not be moved.')
    } finally {
      setPending(false)
      setDragging(null)
      setOver(null)
    }
  }

  function dropOn(group: RoadmapGroup): void {
    const id = dragging
    setOver(null)
    if (!id) return
    const target = moveTargets(view, id).find((entry) => entry.key === group.key)
    if (!target || target.current) {
      setDragging(null)
      return
    }
    void moveCard(id, target.candidate)
  }

  function startPending(): void {
    const core = versionCore(startText)
    if (!core) {
      showToast('Type a version, such as 0.1.0.')
      return
    }
    setStarted(writeStartedPending(project, core))
    setStartOpen(false)
    setStartText('')
  }

  function subtitle(group: RoadmapGroup, index: number): string {
    if (group.kind === 'pending') {
      return layout === 'columns'
        ? 'New approvals land here. Drag a card to another release to defer it.'
        : 'New approvals land here'
    }
    if (group.kind === 'unscheduled') {
      return layout === 'columns'
        ? 'Approved, no release yet. Drag one into a release when you decide.'
        : 'approved, no release yet'
    }
    const before = view.groups[index - 1]
    const after =
      before?.kind === 'pending' ? `next after ${before.version}` : `after ${before?.version ?? ''}`
    return `Planned ${after}.`
  }

  const empty = !pool || view.groups.every((group) => (view.counts[group.key] ?? 0) === 0)

  return (
    <div className={`view roadmap-pool-view rr-view rr-${layout}`}>
      <div className="roadmap-pool-modebar rr-head">
        <strong className="fr-title">Roadmap</strong>
        <span>
          Approved features, grouped into releases. New ones arrive here from Feature requests.
        </span>
        <span className="roadmap-pool-grow" />
        {waiting > 0 && (
          <button
            type="button"
            className="rr-waiting"
            onClick={() => navigate({ kind: 'requests', project })}
          >
            <ListFilter aria-hidden="true" />
            {waiting} request{waiting === 1 ? '' : 's'} waiting for your yes in Feature requests
          </button>
        )}
      </div>
      <div className="roadmap-pool-filters rr-filters">
        <label className="roadmap-pool-search">
          <Search aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Filter features…"
            aria-label="Filter features"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="rr-switch" role="group" aria-label="Whose idea">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`roadmap-pool-filter${filter === id ? ' on' : ''}`}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <LayoutSwitch layout={layout} onLayout={onLayout} />
        <span className="roadmap-pool-grow" />
        {view.inFlight && (
          <span className="rr-inflight">{view.inFlight} is in flight in Releases</span>
        )}
      </div>

      {!view.pending && (
        <div className="rr-start">
          {startOpen ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                startPending()
              }}
            >
              <label htmlFor="rr-start-version">Version of the pending release</label>
              <input
                id="rr-start-version"
                value={startText}
                autoFocus
                placeholder="0.1.0"
                onChange={(event) => setStartText(event.target.value)}
              />
              <button type="submit" className="rr-btn first">
                Start it
              </button>
            </form>
          ) : (
            <button type="button" className="rr-start-btn" onClick={() => setStartOpen(true)}>
              <Plus aria-hidden="true" />
              Start a new pending release
            </button>
          )}
          <p>
            There is no release record to derive a pending version from, so this is the fallback.
          </p>
        </div>
      )}

      {empty && view.pending && (
        <p className="rr-none">
          Nothing is on the Roadmap yet. Approve a request in Feature requests and it lands in
          Pending {view.pending}.
        </p>
      )}

      <div className="rr-groups" role="list" aria-label="Roadmap releases">
        {view.groups.map((group, index) => {
          const isFolded = folded(group)
          const cards = visibleCards(group)
          const more = isFolded ? 0 : group.cards.length - cards.length
          const total = group.cards.length
          return (
            <section
              key={group.key}
              role="listitem"
              className={`rr-group k-${group.kind}${over === group.key ? ' over' : ''}${isFolded ? ' folded' : ''}`}
              data-group={group.key}
              onDragOver={(event) => {
                if (!dragging) return
                event.preventDefault()
                if (over !== group.key) setOver(group.key)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                dropOn(group)
              }}
            >
              <button
                type="button"
                className="rr-group-h"
                aria-expanded={!isFolded}
                disabled={layout === 'columns'}
                onClick={() =>
                  setOpenGroups((previous) => {
                    const next = new Set(previous)
                    if (next.has(group.key)) next.delete(group.key)
                    else next.add(group.key)
                    return next
                  })
                }
              >
                <strong>{group.label}</strong>
                {group.kind === 'pending' && <span className="rr-badge">PENDING</span>}
                <span className="n">{total}</span>
                {layout === 'list' && (
                  <span className="sub">
                    {isFolded && total > 0
                      ? group.cards
                          .slice(0, 3)
                          .map((card) => shortTitle(card.title))
                          .join(' · ')
                      : subtitle(group, index)}
                  </span>
                )}
                {layout === 'list' && (isFolded ? <ChevronRight /> : <ChevronDown />)}
              </button>
              {layout === 'columns' && <p className="rr-sub">{subtitle(group, index)}</p>}
              {!isFolded && total === 0 && (
                <div className="rr-emptybox">
                  {group.kind === 'pending'
                    ? 'Nothing in it yet. Approve a request in Feature requests, or drag a card here.'
                    : group.kind === 'unscheduled'
                      ? 'Nothing unscheduled.'
                      : 'Nothing in it.'}
                </div>
              )}
              {cards.map((card) => (
                <RoadmapCardView
                  key={card.id}
                  card={card}
                  today={day}
                  selected={active === card.id}
                  menuOpen={menuFor === card.id}
                  targets={menuFor === card.id ? moveTargets(view, card.id) : []}
                  pending={view.pending}
                  onSelect={() => setSelected(card.id)}
                  onMenu={() => {
                    setSelected(card.id)
                    setMenuFor(card.id)
                  }}
                  onCloseMenu={() => setMenuFor(null)}
                  onPick={(candidate) => void moveCard(card.id, candidate)}
                  onDragStart={() => setDragging(card.id)}
                  onDragEnd={() => {
                    setDragging(null)
                    setOver(null)
                  }}
                />
              ))}
              {over === group.key && dragging && (
                <div className="rr-drop">
                  Drop here to move it{' '}
                  {group.kind === 'unscheduled' ? 'to Unscheduled' : `into ${group.version}`}
                </div>
              )}
              {more > 0 && (
                <button
                  type="button"
                  className="rr-more"
                  onClick={() => setShownAll((previous) => new Set(previous).add(group.key))}
                >
                  + {more} more feature{more === 1 ? '' : 's'} · show all
                </button>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function RoadmapCardView({
  card,
  today: day,
  selected,
  menuOpen,
  targets,
  pending,
  onSelect,
  onMenu,
  onCloseMenu,
  onPick,
  onDragStart,
  onDragEnd
}: {
  card: RoadmapCard
  today: string
  selected: boolean
  menuOpen: boolean
  targets: ReturnType<typeof moveTargets>
  pending: string | undefined
  onSelect: () => void
  onMenu: () => void
  onCloseMenu: () => void
  onPick: (candidate: string | null) => void
  onDragStart: () => void
  onDragEnd: () => void
}): React.JSX.Element {
  return (
    <article
      className={`rr-card${selected ? ' sel' : ''}${menuOpen ? ' menu-open' : ''}`}
      data-card={card.id}
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', card.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <GripVertical className="rr-grip" aria-hidden="true" />
      <div className="rr-main">
        <h3>{card.title}</h3>
        <div className="rr-chips">
          {card.approvedAt === day && (
            <span className="rr-chip ok">
              <Check aria-hidden="true" />
              Approved today
            </span>
          )}
          <span className="rr-chip tier">{card.tierLabel}</span>
          {card.source === 'you' ? (
            <span className="rr-chip quote">
              <Quote aria-hidden="true" />
              {card.quote ? `“${card.quote}”` : 'From you'}
            </span>
          ) : (
            <span className="rr-chip agent">
              <Bot aria-hidden="true" />
              Agent proposed
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="rr-btn rr-moveto"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Move to… ${card.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onMenu()
        }}
      >
        <Move aria-hidden="true" />
        Move to…
      </button>
      {menuOpen && (
        <RoadmapMoveMenu
          targets={targets}
          pending={pending}
          onPick={onPick}
          onClose={onCloseMenu}
        />
      )}
    </article>
  )
}
