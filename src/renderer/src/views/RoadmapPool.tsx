import { ChevronDown, ChevronRight, ListFilter, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PoolIdea, PoolMoveDirection, PoolTier, ProjectPool } from '../../../main/qa/pool'
import { useCommandScope } from '../commands/provider'
import { useApp } from '../state/app'
import { EmptySurface } from './EmptySurface'
import { RoadmapIdeaSheet, type RoadmapIdeaSheetState } from '../components/RoadmapIdeaSheet'
import { RoadmapIdeaRow, type RoadmapIdeaDraft } from '../components/RoadmapIdeaRow'
import {
  readRoadmapSidebarFolds,
  roadmapSidebarProjects,
  writeRoadmapSidebarFolds,
  type RoadmapSidebarGroup
} from '../lib/roadmapSidebar'

type PoolFilter = 'pool' | 'setaside' | 'promoted'

const FOLD_STORAGE_KEY = 'dtc.roadmap.folded-lanes.v1'
const LANES: ReadonlyArray<{
  tier: PoolTier
  label: string
  subtitle: string
  className: string
}> = [
  {
    tier: 'functionality',
    label: 'Functionality',
    subtitle: 'the app cannot do this at all yet',
    className: 'functionality'
  },
  {
    tier: 'quality-of-life',
    label: 'Quality of life',
    subtitle: 'it works, but it costs you something every time',
    className: 'quality-of-life'
  },
  {
    tier: 'delight',
    label: 'Delight',
    subtitle: 'roadmapped by default, never blocks a release',
    className: 'delight'
  }
]

export function Roadmap(): React.JSX.Element {
  // Which project is shown is the window's scope, not a choice this surface
  // keeps to itself (ADR-0016 § 1).
  const { snapshot, helpOpen, switcherOpen, showToast, scope, setScope, view } = useApp()
  const selectedProjectChoice = scope.kind === 'project' ? scope.slug : null
  const [sidebarQuery] = useState('')
  const [sidebarFolds, setSidebarFolds] = useState(readRoadmapSidebarFolds)
  const [narrowNavigation, setNarrowNavigation] = useState<'projects' | 'pool'>('pool')
  const [filter, setFilter] = useState<PoolFilter>('pool')
  const [query, setQuery] = useState('')
  // A link to a roadmap idea opens with that idea selected (2026-09-26).
  const [selectedIdea, setSelectedIdea] = useState<string | null>(
    view?.kind === 'roadmap' ? (view.idea ?? null) : null
  )
  const [newMarks, setNewMarks] = useState<{ project: string; ids: Set<string> }>(() => ({
    project: '',
    ids: new Set()
  }))
  const [pending, setPending] = useState(false)
  const [draggedIdea, setDraggedIdea] = useState<string | null>(null)
  const [optimisticPool, setOptimisticPool] = useState<ProjectPool | null>(null)
  const [optimisticBaseScan, setOptimisticBaseScan] = useState<string | null>(null)
  const [sheet, setSheet] = useState<RoadmapIdeaSheetState | null>(null)
  const [draft, setDraft] = useState<RoadmapIdeaDraft | null>(null)
  const [folded, setFolded] = useState<Record<string, PoolTier[]>>(readFoldedLanes)
  const visitProject = useRef<string | null>(null)
  const openedProjects = useRef(new Set<string>())
  const searchRef = useRef<HTMLInputElement | null>(null)
  const sidebarSearchRef = useRef<HTMLInputElement | null>(null)

  const pools = snapshot?.pools ?? []
  const sidebarProjects = useMemo(
    () =>
      roadmapSidebarProjects(
        snapshot?.projects ?? [],
        snapshot?.pools ?? [],
        snapshot?.releases ?? []
      ),
    [snapshot?.pools, snapshot?.projects, snapshot?.releases]
  )

  // A pool belongs to one project, so this surface shows the project the
  // window is scoped to and nothing else. It used to fall back to
  // dev-traffic-control, or to whichever project sorted first, whenever the
  // scope was *All projects* — which silently showed the wrong project's
  // roadmap and marked its ideas seen (ticket 13).
  const selectedProject = selectedProjectChoice ?? ''
  const selectableSidebarProjects = useMemo(() => {
    const needle = sidebarQuery.trim().toLocaleLowerCase()
    return sidebarProjects.filter(
      (project) =>
        sidebarFolds[project.group] &&
        (!needle ||
          project.app.toLocaleLowerCase().includes(needle) ||
          project.project.toLocaleLowerCase().includes(needle))
    )
  }, [sidebarFolds, sidebarProjects, sidebarQuery])

  const sourcePool = pools.find((pool) => pool.project === selectedProject) ?? null
  const displayPool =
    optimisticPool?.project === selectedProject && optimisticBaseScan === snapshot?.scannedAt
      ? optimisticPool
      : sourcePool

  useEffect(() => {
    if (!sourcePool || visitProject.current === selectedProject) return
    visitProject.current = selectedProject
    const openedBefore = openedProjects.current.has(selectedProject)
    openedProjects.current.add(selectedProject)
    const marks: Set<string> = openedBefore
      ? new Set<string>()
      : new Set<string>(
          sourcePool.ideas
            .filter((idea) => idea.state === 'pool' && idea.isNew)
            .map((idea) => idea.id)
        )
    const applyMarks = (): void => {
      if (visitProject.current === selectedProject) {
        setNewMarks({ project: selectedProject, ids: marks })
      }
    }
    void window.qa
      .markPoolSeen({ project: selectedProject })
      .then(applyMarks)
      .catch((error) => {
        applyMarks()
        showToast(
          error instanceof Error ? error.message : 'The Roadmap marks could not be cleared.'
        )
      })
  }, [selectedProject, showToast, sourcePool])

  const displayedNewIds = newMarks.project === selectedProject ? newMarks.ids : new Set<string>()

  const counts = useMemo(
    () => ({
      pool: displayPool?.ideas.filter((idea) => idea.state === 'pool').length ?? 0,
      setaside: displayPool?.ideas.filter((idea) => idea.state === 'setaside').length ?? 0,
      promoted: displayPool?.ideas.filter((idea) => idea.state === 'promoted').length ?? 0
    }),
    [displayPool]
  )
  const visibleIdeas = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const matching = (displayPool?.ideas ?? []).filter(
      (idea) =>
        idea.state === filter &&
        (!needle ||
          `${idea.title}\n${idea.bodyMarkdown}\n${idea.candidateRelease ?? ''}\n${idea.setAsideReason ?? ''}`
            .toLocaleLowerCase()
            .includes(needle))
    )
    return filter === 'setaside'
      ? [...matching].sort((left, right) => (right.stateAt ?? '').localeCompare(left.stateAt ?? ''))
      : matching
  }, [displayPool, filter, query])
  const foldedHere = new Set(folded[selectedProject] ?? ['delight'])
  const selectable = visibleIdeas
    .filter((idea) => filter !== 'pool' || !foldedHere.has(idea.tier))
    .map((idea) => idea.id)
  const activeSelected =
    selectedIdea && selectable.includes(selectedIdea) ? selectedIdea : (selectable[0] ?? null)
  const selectedIndex = activeSelected ? selectable.indexOf(activeSelected) : -1
  const commandEnabled =
    !helpOpen && !switcherOpen && !sheet && !draft && filter === 'pool' && !!activeSelected

  const recordedRelease = snapshot?.releases.find(
    (release) => release.kind === 'recorded' && release.project === selectedProject
  )
  const releaseOptions = useMemo(() => {
    const values = new Set<string>()
    if (recordedRelease?.kind === 'recorded') {
      for (const version of recordedRelease.versions) {
        if (!version.shipment) values.add(version.version)
      }
      if (recordedRelease.record.release) values.add(recordedRelease.record.release)
    }
    for (const idea of displayPool?.ideas ?? []) {
      if (idea.candidateRelease) values.add(idea.candidateRelease)
    }
    return [...values]
  }, [displayPool?.ideas, recordedRelease])

  async function move(direction: PoolMoveDirection): Promise<void> {
    if (!activeSelected || pending || !displayPool) return
    setPending(true)
    try {
      const result = await window.qa.reorderPool({
        project: displayPool.project,
        id: activeSelected,
        direction
      })
      setOptimisticPool(result.pool)
      setOptimisticBaseScan(snapshot?.scannedAt ?? null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The Roadmap order could not be saved.')
    } finally {
      setPending(false)
    }
  }

  async function placeIdea(beforeId: string): Promise<void> {
    if (!draggedIdea || draggedIdea === beforeId || pending || !displayPool) return
    setPending(true)
    try {
      const result = await window.qa.reorderPool({
        project: displayPool.project,
        id: draggedIdea,
        beforeId
      })
      setOptimisticPool(result.pool)
      setOptimisticBaseScan(snapshot?.scannedAt ?? null)
      setSelectedIdea(draggedIdea)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The Roadmap order could not be saved.')
    } finally {
      setPending(false)
      setDraggedIdea(null)
    }
  }

  function openPromote(idea: PoolIdea): void {
    const release = idea.candidateRelease ?? releaseOptions[0] ?? ''
    setSelectedIdea(idea.id)
    setSheet({
      kind: 'promote',
      idea,
      release,
      customRelease: !!release && !releaseOptions.includes(release),
      specWanted: true
    })
  }

  function openSetAside(idea: PoolIdea): void {
    setSelectedIdea(idea.id)
    setSheet({ kind: 'setaside', idea, reason: '' })
  }

  function openAdd(): void {
    const selected = displayPool?.ideas.find((candidate) => candidate.id === activeSelected)
    setSheet({
      kind: 'add',
      title: '',
      bodyMarkdown: '',
      tier: selected?.tier ?? 'functionality'
    })
  }

  function openEdit(idea: PoolIdea): void {
    setSelectedIdea(idea.id)
    setDraft({ id: idea.id, title: idea.title, bodyMarkdown: idea.bodyMarkdown })
  }

  async function confirmSheet(): Promise<void> {
    if (!sheet || pending || !displayPool) return
    if (sheet.kind === 'promote' && !sheet.release.trim()) return
    if (sheet.kind === 'setaside' && !sheet.reason.trim()) return
    if (sheet.kind === 'add' && !sheet.title.trim()) return
    setPending(true)
    try {
      if (sheet.kind === 'add') {
        const result = await window.qa.writePoolIdea({
          project: displayPool.project,
          action: 'add',
          title: sheet.title,
          bodyMarkdown: sheet.bodyMarkdown,
          tier: sheet.tier
        })
        setOptimisticPool(result.pool)
        setOptimisticBaseScan(snapshot?.scannedAt ?? null)
        setSelectedIdea(result.id)
        setSheet(null)
        return
      }
      const pool = await window.qa.transitionPool(
        sheet.kind === 'promote'
          ? {
              project: displayPool.project,
              id: sheet.idea.id,
              action: 'promote',
              release: sheet.release,
              specWanted: sheet.specWanted
            }
          : {
              project: displayPool.project,
              id: sheet.idea.id,
              action: 'setaside',
              reason: sheet.reason
            }
      )
      setOptimisticPool(pool)
      setOptimisticBaseScan(snapshot?.scannedAt ?? null)
      setSheet(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The Roadmap change could not be saved.')
    } finally {
      setPending(false)
    }
  }

  async function saveEdit(): Promise<void> {
    if (!draft || !draft.title.trim() || pending || !displayPool) return
    const original = displayPool.ideas.find((idea) => idea.id === draft.id)
    if (!original) return
    setPending(true)
    try {
      const result = await window.qa.writePoolIdea({
        project: displayPool.project,
        action: 'edit',
        id: draft.id,
        ...(draft.title.trim() !== original.title ? { title: draft.title } : {}),
        ...(draft.bodyMarkdown !== original.bodyMarkdown
          ? { bodyMarkdown: draft.bodyMarkdown }
          : {})
      })
      setOptimisticPool(result.pool)
      setOptimisticBaseScan(snapshot?.scannedAt ?? null)
      setSelectedIdea(result.id)
      setDraft(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The idea could not be saved.')
    } finally {
      setPending(false)
    }
  }

  async function putBack(idea: PoolIdea): Promise<void> {
    if (pending || !displayPool) return
    setPending(true)
    try {
      const pool = await window.qa.transitionPool({
        project: displayPool.project,
        id: idea.id,
        action: 'restore'
      })
      setOptimisticPool(pool)
      setOptimisticBaseScan(snapshot?.scannedAt ?? null)
      setSelectedIdea(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The idea could not be put back.')
    } finally {
      setPending(false)
    }
  }

  useCommandScope({
    'nav.move-down': {
      enabled: !helpOpen && !switcherOpen && selectable.length > 0,
      handler: () =>
        setSelectedIdea(
          selectable[Math.min(selectedIndex + 1, selectable.length - 1)] ?? selectable[0]
        )
    },
    'nav.move-up': {
      enabled: !helpOpen && !switcherOpen && selectable.length > 0,
      handler: () => setSelectedIdea(selectable[Math.max(selectedIndex - 1, 0)] ?? selectable[0])
    },
    'app.find-document': {
      enabled: !helpOpen && !switcherOpen,
      handler: () =>
        narrowNavigation === 'projects'
          ? sidebarSearchRef.current?.focus()
          : searchRef.current?.focus()
    },
    'roadmap.project-previous': {
      enabled: !helpOpen && !switcherOpen && selectableSidebarProjects.length > 0,
      handler: () => moveProject(-1)
    },
    'roadmap.project-next': {
      enabled: !helpOpen && !switcherOpen && selectableSidebarProjects.length > 0,
      handler: () => moveProject(1)
    },
    'roadmap.toggle-with-ideas-group': {
      enabled: !helpOpen && !switcherOpen,
      handler: () => toggleSidebarGroup('with-ideas')
    },
    'roadmap.toggle-nothing-in-pool-group': {
      enabled: !helpOpen && !switcherOpen,
      handler: () => toggleSidebarGroup('nothing-in-pool')
    },
    'roadmap.move-up': { enabled: commandEnabled && !pending, handler: () => void move('up') },
    'roadmap.move-down': {
      enabled: commandEnabled && !pending,
      handler: () => void move('down')
    },
    'roadmap.move-left': {
      enabled: commandEnabled && !pending,
      handler: () => void move('left')
    },
    'roadmap.move-right': {
      enabled: commandEnabled && !pending,
      handler: () => void move('right')
    },
    'roadmap.promote': {
      enabled: commandEnabled && !pending,
      handler: () => {
        const idea = displayPool?.ideas.find((candidate) => candidate.id === activeSelected)
        if (idea) openPromote(idea)
      }
    },
    'roadmap.edit-idea': {
      enabled: commandEnabled && !pending,
      handler: () => {
        const idea = displayPool?.ideas.find((candidate) => candidate.id === activeSelected)
        if (idea) openEdit(idea)
      }
    },
    'roadmap.set-aside': {
      enabled: commandEnabled && !pending,
      handler: () => {
        const idea = displayPool?.ideas.find((candidate) => candidate.id === activeSelected)
        if (idea) openSetAside(idea)
      }
    },
    'roadmap.put-back': {
      enabled: !sheet && filter === 'setaside' && !!activeSelected && !pending,
      handler: () => {
        const idea = displayPool?.ideas.find((candidate) => candidate.id === activeSelected)
        if (idea) void putBack(idea)
      }
    },
    'roadmap.confirm-action': {
      enabled: (!!sheet || !!draft) && !pending,
      priority: 50,
      handler: () => (draft ? void saveEdit() : void confirmSheet())
    },
    'roadmap.choose-sheet-option': {
      enabled: !!sheet && sheet.kind === 'promote' && !pending,
      priority: 50,
      handler: (event) => {
        if (!sheet || sheet.kind !== 'promote' || !event) return
        const index = Number(event.key) - 1
        if (index < releaseOptions.length) {
          setSheet({ ...sheet, release: releaseOptions[index], customRelease: false })
        } else if (index === releaseOptions.length) {
          setSheet({ ...sheet, release: '', customRelease: true })
        } else if (index === releaseOptions.length + 1) {
          setSheet({ ...sheet, specWanted: true })
        } else if (index === releaseOptions.length + 2) {
          setSheet({ ...sheet, specWanted: false })
        }
      }
    },
    'roadmap.filter-pool': {
      enabled: !sheet,
      handler: () => setFilter('pool')
    },
    'roadmap.filter-set-aside': {
      enabled: !sheet,
      handler: () => setFilter('setaside')
    },
    'roadmap.filter-promoted': {
      enabled: !sheet,
      handler: () => setFilter('promoted')
    },
    'roadmap.toggle-functionality': {
      enabled: !sheet && filter === 'pool',
      handler: () => toggleLane('functionality')
    },
    'roadmap.toggle-quality-of-life': {
      enabled: !sheet && filter === 'pool',
      handler: () => toggleLane('quality-of-life')
    },
    'roadmap.toggle-delight': {
      enabled: !sheet && filter === 'pool',
      handler: () => toggleLane('delight')
    },
    'roadmap.add-idea': {
      enabled: !sheet && !draft && filter === 'pool' && !pending,
      handler: openAdd
    },
    'app.close-back': {
      enabled: !!sheet || !!draft,
      priority: 50,
      handler: () => {
        setSheet(null)
        setDraft(null)
      }
    }
  })

  function toggleLane(tier: PoolTier): void {
    setFolded((current) => {
      const nextForProject = new Set(current[selectedProject] ?? ['delight'])
      if (nextForProject.has(tier)) nextForProject.delete(tier)
      else nextForProject.add(tier)
      const next = { ...current, [selectedProject]: [...nextForProject] }
      writeFoldedLanes(next)
      return next
    })
  }

  function selectProject(project: string): void {
    setScope({ kind: 'project', slug: project })
    setSelectedIdea(null)
    setNarrowNavigation('pool')
  }

  function moveProject(offset: -1 | 1): void {
    const index = Math.max(
      0,
      selectableSidebarProjects.findIndex((project) => project.project === selectedProject)
    )
    const next =
      selectableSidebarProjects[
        Math.max(0, Math.min(selectableSidebarProjects.length - 1, index + offset))
      ]
    if (next) selectProject(next.project)
  }

  function toggleSidebarGroup(group: RoadmapSidebarGroup): void {
    setSidebarFolds((current) => {
      const next = { ...current, [group]: !current[group] }
      writeRoadmapSidebarFolds(next)
      return next
    })
  }

  const projectName =
    sidebarProjects.find((project) => project.project === selectedProject)?.app ??
    displayName(selectedProject, snapshot?.releases ?? [])
  // Ticket 07, as far as Dominik asked on 2026-09-26: the window's scope
  // decides the project, so this surface draws no project list of its own.
  if (snapshot?.rootMissing) {
    return (
      <div className="view roadmap-pool-view">
        <div className="roadmap-pool-error" role="alert">
          Record folder not found at {snapshot.root}. Open Settings to point Dev Traffic Control at
          the folder again.
        </div>
      </div>
    )
  }
  // *All projects* is a scope of its own, not a licence to guess. A pool
  // belongs to one project, so the surface says plainly that it needs one
  // chosen rather than showing a project the window is not on (ticket 13).
  if (scope.kind === 'all') {
    return (
      <div className="view roadmap-pool-view roadmap-project-layout roadmap-narrow-navigation-pool">
        <div className="roadmap-project-detail">
          <div className="view surface-empty-view">
            <div className="surface-empty">
              <span className="surface-empty-icon" aria-hidden="true">
                <ListFilter />
              </span>
              <h2>Pick a project to see its roadmap</h2>
              <p>
                A pool of ideas belongs to one project, and this window is on <b>All projects</b>.
                Choose one in the list beside this, in the project rail, or in the switcher.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (sourcePool && sourcePool.ideas.length === 0) {
    return (
      <div
        className={`view roadmap-pool-view roadmap-project-layout roadmap-narrow-navigation-pool`}
      >
        <div className="roadmap-project-detail">
          <EmptySurface
            surface="roadmap"
            projectName={projectName}
            setAsideCount={counts.setaside}
            onShowProjects={() => setNarrowNavigation('projects')}
            onAddIdea={openAdd}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`view roadmap-pool-view roadmap-project-layout roadmap-narrow-navigation-pool`}>
      <div className="roadmap-project-detail">
        <div className="roadmap-pool-modebar">
          <span>
            {filter === 'setaside'
              ? `set aside — ${counts.setaside} ideas, kept for the record`
              : filter === 'promoted'
                ? `promoted — ${counts.promoted} ideas now in releases`
                : `${counts.pool} ideas · ${displayedNewIds.size} new since your last look`}
          </span>
          <span className="roadmap-pool-grow" />
          {filter === 'pool' ? (
            <>
              <button type="button" className="roadmap-pool-action secondary" disabled>
                <ListFilter /> Sort this out
              </button>
              <button
                type="button"
                className="roadmap-pool-action"
                disabled={pending}
                onClick={openAdd}
              >
                <Plus /> Add an idea
              </button>
            </>
          ) : (
            <button
              type="button"
              className="roadmap-pool-action secondary"
              onClick={() => setFilter('pool')}
            >
              Back to the pool
            </button>
          )}
        </div>
        <div className="roadmap-pool-filters">
          <label className="roadmap-pool-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Filter these ideas…"
              aria-label="Filter these ideas"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {(
            [
              ['pool', 'In the pool'],
              ['setaside', 'Set aside'],
              ['promoted', 'Promoted']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`roadmap-pool-filter${filter === value ? ' on' : ''}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label} <span>{counts[value]}</span>
            </button>
          ))}
          <span className="roadmap-pool-grow" />
          <strong className="roadmap-pool-order-law">
            {filter === 'setaside'
              ? 'Sorted by: when you set it aside ▾'
              : filter === 'promoted'
                ? 'Sorted by: pool order'
                : 'Your order — agents never change it'}
          </strong>
        </div>

        {visibleIdeas.length === 0 ? (
          <div className="roadmap-pool-no-results">
            <h2>{emptyFilterTitle(filter, query)}</h2>
            <p>{emptyFilterDescription(filter, query)}</p>
          </div>
        ) : filter === 'pool' ? (
          <div className="roadmap-pool-scroll" role="list" aria-label={`${projectName} idea pool`}>
            {LANES.map((lane) => {
              const ideas = visibleIdeas.filter((idea) => idea.tier === lane.tier)
              const isFolded = foldedHere.has(lane.tier)
              const laneNewCount = ideas.filter((idea) => displayedNewIds.has(idea.id)).length
              return (
                <section className={`roadmap-lane ${lane.className}`} key={lane.tier}>
                  <button
                    type="button"
                    className="roadmap-lane-header"
                    aria-expanded={!isFolded}
                    onClick={() => toggleLane(lane.tier)}
                  >
                    <strong>{lane.label}</strong>
                    <span>
                      {ideas.length} {ideas.length === 1 ? 'idea' : 'ideas'}
                      {laneNewCount > 0 ? ` · ${laneNewCount} new` : ''}
                      {isFolded ? ' — folded' : ''}
                    </span>
                    <span className="roadmap-pool-grow" />
                    <span>{lane.subtitle}</span>
                    {isFolded ? <ChevronRight /> : <ChevronDown />}
                  </button>
                  {!isFolded &&
                    ideas.map((idea) => (
                      <RoadmapIdeaRow
                        key={idea.id}
                        idea={idea}
                        focused={activeSelected === idea.id}
                        isNew={displayedNewIds.has(idea.id)}
                        pending={pending && activeSelected === idea.id}
                        dragging={draggedIdea === idea.id}
                        draft={draft?.id === idea.id ? draft : undefined}
                        onDraftChange={setDraft}
                        onFocus={() => setSelectedIdea(idea.id)}
                        onDragStart={() => {
                          setDraggedIdea(idea.id)
                          setSelectedIdea(idea.id)
                        }}
                        onDragEnd={() => setDraggedIdea(null)}
                        onDrop={() => void placeIdea(idea.id)}
                        onEdit={() => openEdit(idea)}
                        onSaveEdit={() => void saveEdit()}
                        onCancelEdit={() => setDraft(null)}
                        onPromote={() => openPromote(idea)}
                      />
                    ))}
                </section>
              )
            })}
          </div>
        ) : (
          <div className="roadmap-pool-scroll" role="list">
            {visibleIdeas.map((idea) => (
              <RoadmapIdeaRow
                key={idea.id}
                idea={idea}
                focused={activeSelected === idea.id}
                isNew={displayedNewIds.has(idea.id)}
                dragging={false}
                onFocus={() => setSelectedIdea(idea.id)}
                stateView
                pending={pending && activeSelected === idea.id}
                onRestore={idea.state === 'setaside' ? () => void putBack(idea) : undefined}
              />
            ))}
          </div>
        )}
        {sheet && (
          <RoadmapIdeaSheet
            sheet={sheet}
            releases={releaseOptions}
            pending={pending}
            onChange={setSheet}
            onCancel={() => setSheet(null)}
            onConfirm={() => void confirmSheet()}
          />
        )}
      </div>
    </div>
  )
}

function displayName(
  project: string,
  releases: NonNullable<ReturnType<typeof useApp>['snapshot']>['releases']
): string {
  const release = releases.find(
    (candidate) => candidate.kind === 'recorded' && candidate.project === project
  )
  if (release?.kind === 'recorded' && release.record.app) return release.record.app
  return project
    .split('-')
    .filter(Boolean)
    .map((word) => `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ')
}

function emptyFilterTitle(filter: PoolFilter, query: string): string {
  if (query.trim()) return 'No ideas match'
  if (filter === 'setaside') return 'No ideas set aside'
  if (filter === 'promoted') return 'No ideas promoted'
  return 'Nothing in this pool'
}

function emptyFilterDescription(filter: PoolFilter, query: string): string {
  if (query.trim()) return 'Clear the text box or change the filter to see the other ideas.'
  if (filter === 'setaside') return 'Ideas kept for the record will appear here.'
  if (filter === 'promoted') return 'Ideas moved into a release will appear here.'
  return 'Agents add ideas as they arise.'
}

function readFoldedLanes(): Record<string, PoolTier[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FOLD_STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, PoolTier[]> = {}
    for (const [project, tiers] of Object.entries(parsed)) {
      if (!Array.isArray(tiers)) continue
      result[project] = tiers.filter((tier): tier is PoolTier =>
        LANES.some((lane) => lane.tier === tier)
      )
    }
    return result
  } catch {
    return {}
  }
}

function writeFoldedLanes(folded: Record<string, PoolTier[]>): void {
  try {
    localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(folded))
  } catch {
    // A blocked local store leaves folding session-local; the pool remains usable.
  }
}
