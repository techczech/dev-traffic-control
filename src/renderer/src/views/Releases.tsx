import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReleaseVerdict } from '../../../main/qa/releaseRecords'
import { ReleaseVersions } from '../components/ReleaseVersions'
import { ReleaseFeatureRow } from '../components/ReleaseFeatureRow'
import { useCommandScope } from '../commands/provider'
import {
  releaseBoardRows,
  type ReleaseBoardFeatureRow,
  type ReleaseBoardItem,
  type ReleaseBoardRow
} from '../lib/releases'
import {
  readReleaseSidebarFolds,
  readReleaseVersionLayouts,
  releaseNarrowNavigationColumn,
  releaseSidebarProjects,
  writeReleaseSidebarFolds,
  writeReleaseVersionLayouts,
  type ReleaseSidebarGroup,
  type ReleaseVersionLayout
} from '../lib/releaseSidebar'
import { useApp } from '../state/app'
import { EmptySurface } from './EmptySurface'

type BoardFilter = 'everything' | 'you' | 'building' | 'notstarted'
type ReleaseScope = 'in-flight' | 'shipped'
type ReleaseSurface = 'projects' | 'board'

export function Releases(): React.JSX.Element {
  // `scope` is this surface's in-flight/shipped toggle; the WINDOW's scope —
  // which project is shown — arrives as `windowScope` and is no longer this
  // surface's own stored choice (ADR-0016 § 1).
  const {
    snapshot,
    helpOpen,
    switcherOpen,
    showToast,
    scope: windowScope,
    setScope: setWindowScope,
    view
  } = useApp()
  // A link can open this surface at one version and feature (2026-09-26).
  const linked = view?.kind === 'releases' ? view : null
  const [scope, setScope] = useState<ReleaseScope>('in-flight')
  const [filter, setFilter] = useState<BoardFilter>('everything')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [openChecks, setOpenChecks] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [comments, setComments] = useState<Record<string, string>>({})
  const [surface, setSurface] = useState<ReleaseSurface>('projects')
  const [selectedVersion, setSelectedVersion] = useState<string | undefined>(linked?.version)
  const [sidebarQuery] = useState('')
  const [sidebarFolds, setSidebarFolds] = useState(readReleaseSidebarFolds)
  const [versionLayouts, setVersionLayouts] = useState(readReleaseVersionLayouts)
  const [now, setNow] = useState(() => new Date())
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const rows = useMemo(
    () => releaseBoardRows(snapshot?.releases ?? [], snapshot?.pools ?? []),
    [snapshot?.pools, snapshot?.releases]
  )
  const inFlightProjects = useMemo(
    () =>
      new Set(
        (snapshot?.releases ?? []).flatMap((release) =>
          release.kind === 'recorded' && release.inFlightVersion ? [release.project] : []
        )
      ),
    [snapshot?.releases]
  )
  const inFlightRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.kind === 'nothing-recorded' ||
          row.kind === 'proposed' ||
          inFlightProjects.has(row.project)
      ),
    [inFlightProjects, rows]
  )
  const sidebarProjects = useMemo(
    () =>
      releaseSidebarProjects(
        snapshot?.projects ?? [],
        snapshot?.releases ?? [],
        snapshot?.pools ?? []
      ),
    [snapshot?.pools, snapshot?.projects, snapshot?.releases]
  )
  // *All projects* means every project, which on this surface is the board —
  // never a silent fall back to whichever project happens to sort first
  // (ticket 13). A scope naming a project with no release record falls through
  // to the board too, rather than showing someone else's release.
  const selectedProject = windowScope.kind === 'project' ? windowScope.slug : null
  const activeProject = sidebarProjects.some((project) => project.project === selectedProject)
    ? selectedProject
    : null
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
  const appCount = new Set(inFlightRows.map((row) => row.project)).size
  const featureRows = useMemo(
    () => inFlightRows.flatMap((row) => (row.kind === 'nothing-recorded' ? [] : row.features)),
    [inFlightRows]
  )
  const counts = useMemo(
    () => ({
      everything: featureRows.filter((item) => item.kind === 'feature').length,
      you: featureRows.filter((item) => item.kind === 'feature' && item.status === 'you').length,
      building: featureRows.filter((item) => item.kind === 'feature' && item.status === 'building')
        .length,
      notstarted: featureRows.filter(
        (item) => item.kind === 'feature' && item.status === 'notstarted'
      ).length
    }),
    [featureRows]
  )
  const visible = useMemo(
    () => filterRows(inFlightRows, filter, query),
    [filter, inFlightRows, query]
  )
  const selectable = useMemo(
    () =>
      visible.flatMap((row) =>
        row.kind !== 'nothing-recorded' && !row.collapsed
          ? row.features
              .filter((item): item is ReleaseBoardFeatureRow => item.kind === 'feature')
              .map((item) => itemKey(row, item))
          : []
      ),
    [visible]
  )

  const activeSelected =
    selected && selectable.includes(selected) ? selected : (selectable[0] ?? null)
  const selectedIndex = activeSelected ? selectable.indexOf(activeSelected) : -1
  const selectedPair = activeSelected ? findItem(inFlightRows, activeSelected) : null
  const commandEnabled = !helpOpen && !switcherOpen && surface === 'board' && scope === 'in-flight'
  const selectedRelease =
    activeProject && snapshot
      ? (snapshot.releases.find((release) => release.project === activeProject) ?? {
          kind: 'nothing-recorded' as const,
          project: activeProject
        })
      : undefined
  const toggleSelectedCheck = (): void => {
    if (!selectedPair?.item.howToCheck) return
    setOpenChecks((current) => toggled(current, activeSelected))
  }
  useCommandScope({
    'nav.move-down': {
      enabled: commandEnabled && selectable.length > 0,
      handler: () =>
        setSelected(selectable[Math.min(selectedIndex + 1, selectable.length - 1)] ?? selectable[0])
    },
    'nav.move-up': {
      enabled: commandEnabled && selectable.length > 0,
      handler: () => setSelected(selectable[Math.max(selectedIndex - 1, 0)] ?? selectable[0])
    },
    'app.find-document': {
      enabled: !helpOpen && !switcherOpen,
      handler: () => searchRef.current?.focus()
    },
    'release.answer-works': {
      enabled:
        commandEnabled && selectedPair?.row.kind === 'recorded' && !!selectedPair.item.answerable,
      handler: () =>
        selectedPair?.row.kind === 'recorded' &&
        void answer(selectedPair.row, selectedPair.item, 'works')
    },
    'release.flag-feature': {
      enabled:
        commandEnabled && selectedPair?.row.kind === 'recorded' && !!selectedPair.item.answerable,
      handler: () =>
        selectedPair?.row.kind === 'recorded' &&
        void answer(selectedPair.row, selectedPair.item, 'off')
    },
    'release.toggle-how-to': {
      enabled: commandEnabled && !!selectedPair?.item.howToCheck,
      handler: toggleSelectedCheck
    },
    'release.open-app': {
      enabled: commandEnabled && !!selectedPair,
      handler: () => selectedPair && openApp(selectedPair.row.project)
    },
    'release.show-board': {
      enabled: !helpOpen && !switcherOpen && surface === 'projects',
      handler: () => setSurface('board')
    },
    'release.project-previous': {
      enabled:
        !helpOpen &&
        !switcherOpen &&
        surface === 'projects' &&
        selectableSidebarProjects.length > 0,
      handler: () => moveProject(-1)
    },
    'release.project-next': {
      enabled:
        !helpOpen &&
        !switcherOpen &&
        surface === 'projects' &&
        selectableSidebarProjects.length > 0,
      handler: () => moveProject(1)
    },
    'release.toggle-needs-you-group': {
      enabled: surface === 'projects',
      handler: () => toggleSidebarGroup('needs-you')
    },
    'release.toggle-in-flight-group': {
      enabled: surface === 'projects',
      handler: () => toggleSidebarGroup('in-flight')
    },
    'release.toggle-nothing-declared-group': {
      enabled: surface === 'projects',
      handler: () => toggleSidebarGroup('nothing-declared')
    },
    'release.scope-in-flight': {
      enabled: surface === 'board',
      handler: () => setScope('in-flight')
    },
    'release.scope-shipped': {
      enabled: surface === 'board',
      handler: () => setScope('shipped')
    },
    'release.filter-everything': {
      enabled: surface === 'board',
      handler: () => setFilter('everything')
    },
    'release.filter-you': {
      enabled: surface === 'board',
      handler: () => setFilter('you')
    },
    'release.filter-building': {
      enabled: surface === 'board',
      handler: () => setFilter('building')
    },
    'release.filter-not-started': {
      enabled: surface === 'board',
      handler: () => setFilter('notstarted')
    }
  })

  function openApp(project: string, version?: string): void {
    selectProject(project)
    setSelectedVersion(version)
    setSurface('projects')
  }

  function selectProject(project: string): void {
    setSelectedVersion(undefined)
    setWindowScope({ kind: 'project', slug: project })
  }

  function moveProject(offset: -1 | 1): void {
    const index = Math.max(
      0,
      selectableSidebarProjects.findIndex((project) => project.project === activeProject)
    )
    const next =
      selectableSidebarProjects[
        Math.max(0, Math.min(selectableSidebarProjects.length - 1, index + offset))
      ]
    if (next) selectProject(next.project)
  }

  function toggleSidebarGroup(group: ReleaseSidebarGroup): void {
    setSidebarFolds((current) => {
      const next = { ...current, [group]: !current[group] }
      writeReleaseSidebarFolds(next)
      return next
    })
  }

  function setVersionLayout(project: string, layout: ReleaseVersionLayout): void {
    setVersionLayouts((current) => {
      const next = { ...current, [project]: layout }
      writeReleaseVersionLayouts(next)
      return next
    })
  }

  async function answer(
    row: Extract<ReleaseBoardRow, { kind: 'recorded' }>,
    item: ReleaseBoardFeatureRow,
    verdict: ReleaseVerdict,
    comment = verdict === 'off' ? (comments[itemKey(row, item)] ?? item.answer?.comment ?? '') : ''
  ): Promise<void> {
    const key = itemKey(row, item)
    setPending((current) => new Set(current).add(key))
    try {
      await window.qa.answerRelease({
        project: row.project,
        version: row.version,
        id: item.id,
        verdict,
        comment
      })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The release answer could not be saved.')
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  if (snapshot && sidebarProjects.length === 0) return <EmptySurface surface="releases" />

  if (surface === 'projects' && selectedRelease && activeProject && snapshot) {
    const versionLayout = versionLayouts[activeProject] ?? 'pills'
    const narrowNavigation = releaseNarrowNavigationColumn(versionLayout)
    return (
      <div
        className={`view releases-view release-project-layout release-narrow-navigation-${narrowNavigation}`}
      >
        {/* Ticket 06, as far as Dominik asked on 2026-09-26: the window's scope
            decides the project, so this surface draws no project list of its
            own ("they should work the same as dash and inbox"). */}
        <div className="release-project-detail">
          <ReleaseVersions
            key={activeProject}
            release={selectedRelease}
            pool={snapshot.pools.find((pool) => pool.project === selectedRelease.project)}
            initialVersion={selectedVersion}
            initialFeature={linked?.feature}
            now={now}
            versionLayout={versionLayout}
            onVersionLayoutChange={(layout) => setVersionLayout(activeProject, layout)}
            onError={showToast}
            onCopied={() => showToast('Frozen release notes copied')}
            onShipped={(version) =>
              showToast(
                `${selectedRelease.kind === 'recorded' ? (selectedRelease.record.app ?? activeProject) : activeProject} ${version} shipped`
              )
            }
          />
        </div>
      </div>
    )
  }

  const shipped = (snapshot?.releases ?? []).flatMap((release) =>
    release.kind === 'recorded'
      ? (release.shippedVersions ?? []).map((version) => ({
          project: release.project,
          app: release.record.app?.trim() || release.project,
          version
        }))
      : []
  )

  return (
    <div className="view releases-view">
      <div className="releases-modebar">
        <div>
          {/* This heading survives ticket 14's sweep because it does not repeat
              the tab. The tab says "Releases"; this says which half of Releases
              is on screen, and it changes when the scope tabs beside it change.
              A heading that only echoed the tab would be the duplicate. */}
          <h1>{scope === 'in-flight' ? 'In flight' : 'Shipped'}</h1>
          <span>
            {scope === 'in-flight'
              ? `${appCount} ${appCount === 1 ? 'app' : 'apps'} · ${counts.everything} features · ${counts.you} waiting on you`
              : `${shipped.length} shipped ${shipped.length === 1 ? 'version' : 'versions'}`}
          </span>
        </div>
        <div className="releases-scope-tabs" role="tablist" aria-label="Release scope">
          <button
            type="button"
            className={scope === 'in-flight' ? 'on' : ''}
            aria-selected={scope === 'in-flight'}
            role="tab"
            onClick={() => setScope('in-flight')}
          >
            In flight
          </button>
          <button
            type="button"
            className={scope === 'shipped' ? 'on' : ''}
            aria-selected={scope === 'shipped'}
            role="tab"
            onClick={() => setScope('shipped')}
          >
            Shipped
          </button>
        </div>
      </div>

      {scope === 'shipped' ? (
        <div className="releases-shipped-list">
          {shipped.length > 0 ? (
            shipped.map(({ project, app, version }) => (
              <button
                type="button"
                className="release-shipped-row"
                key={`${project}:${version}`}
                onClick={() => openApp(project, version)}
              >
                <strong>{app}</strong>
                <span>{version}</span>
              </button>
            ))
          ) : (
            <div className="releases-no-results">
              <h2>No shipped versions recorded</h2>
              <p>Only versions represented by release records appear here.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="releases-filters">
            <label className="releases-search">
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Filter by app or feature…"
                aria-label="Filter releases by app or feature"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {(
              [
                ['everything', 'Everything'],
                ['you', 'Waiting on you'],
                ['building', 'Being built'],
                ['notstarted', 'Not started']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`releases-filter-chip${filter === value ? ' on' : ''}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label} <span>{counts[value]}</span>
              </button>
            ))}
            <span className="releases-filter-grow" />
            <span className="releases-sort-label">Sorted by: what needs you first ▾</span>
          </div>
          <div className="releases-board" role="list" aria-label="Releases in flight">
            {visible.length > 0 ? (
              visible.map((row) => {
                if (row.kind === 'nothing-recorded') {
                  return (
                    <section className="release-app release-no-record" key={row.project}>
                      <div className="release-app-header">
                        <strong>{row.app}</strong>
                        <em>no release record — nobody has said what it is working towards</em>
                      </div>
                    </section>
                  )
                }
                return (
                  <section
                    className={`release-app${row.kind === 'proposed' ? ' proposed' : ''}${row.needsYou ? ' needs-you' : ''}${row.collapsed ? ' collapsed' : ''}`}
                    key={`${row.project}:${row.version}`}
                  >
                    <button
                      type="button"
                      className="release-app-header"
                      onClick={() => openApp(row.project, row.version)}
                    >
                      <strong>{row.app}</strong>
                      <span className="release-version">{row.release}</span>
                      {row.kind === 'proposed' && (
                        <span className="release-proposed-badge">{row.label}</span>
                      )}
                      <span className="release-tally">{tally(row)}</span>
                      <span className="release-app-grow" />
                      {row.needsYou && <span className="release-needs-badge">Needs you</span>}
                      <span className="release-caret" aria-hidden="true">
                        {row.collapsed ? '▸' : '▾'}
                      </span>
                    </button>
                    {!row.collapsed &&
                      row.features.map((item) => {
                        const key = itemKey(row, item)
                        return (
                          <ReleaseFeatureRow
                            key={key}
                            item={item}
                            focused={key === activeSelected}
                            now={now}
                            readShot={(rel) =>
                              window.qa.readVerdictShot({
                                project: row.project,
                                version: row.version,
                                rel
                              })
                            }
                            howToOpen={openChecks.has(key)}
                            pending={pending.has(key)}
                            comment={
                              comments[key] ??
                              (item.kind === 'feature' ? (item.answer?.comment ?? '') : '')
                            }
                            onFocus={() => item.kind === 'feature' && setSelected(key)}
                            onToggleHowTo={() => setOpenChecks((current) => toggled(current, key))}
                            onWorks={() =>
                              row.kind === 'recorded' &&
                              item.kind === 'feature' &&
                              void answer(row, item, 'works')
                            }
                            onFlag={() =>
                              row.kind === 'recorded' &&
                              item.kind === 'feature' &&
                              void answer(row, item, 'off')
                            }
                            onCommentChange={(comment) =>
                              setComments((current) => ({ ...current, [key]: comment }))
                            }
                            onCommentCommit={() =>
                              row.kind === 'recorded' &&
                              item.kind === 'feature' &&
                              void answer(row, item, 'off')
                            }
                          />
                        )
                      })}
                  </section>
                )
              })
            ) : (
              <div className="releases-no-results">
                <h2>No release features match</h2>
                <p>Change the filter or clear the text box to see the other features.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function itemKey(
  row: Exclude<ReleaseBoardRow, { kind: 'nothing-recorded' }>,
  item: ReleaseBoardItem
): string {
  return `${row.project}:${row.version}:${item.id}`
}

function findItem(
  rows: readonly ReleaseBoardRow[],
  key: string
): {
  row: Exclude<ReleaseBoardRow, { kind: 'nothing-recorded' }>
  item: ReleaseBoardFeatureRow
} | null {
  for (const row of rows) {
    if (row.kind === 'nothing-recorded') continue
    const item = row.features.find(
      (candidate): candidate is ReleaseBoardFeatureRow =>
        candidate.kind === 'feature' && itemKey(row, candidate) === key
    )
    if (item) return { row, item }
  }
  return null
}

function toggled(current: ReadonlySet<string>, key: string | null): Set<string> {
  const next = new Set(current)
  if (!key) return next
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function filterRows(
  rows: readonly ReleaseBoardRow[],
  filter: BoardFilter,
  query: string
): ReleaseBoardRow[] {
  const needle = query.trim().toLocaleLowerCase()
  return rows.flatMap((row): ReleaseBoardRow[] => {
    if (row.kind === 'nothing-recorded') {
      return filter === 'everything' && (!needle || row.app.toLocaleLowerCase().includes(needle))
        ? [row]
        : []
    }
    const appMatches = !needle || row.app.toLocaleLowerCase().includes(needle)
    const features = row.features.filter((item) => {
      if (filter !== 'everything' && (item.kind !== 'feature' || item.status !== filter))
        return false
      if (appMatches) return true
      return `${item.title}\n${item.prose ?? ''}`.toLocaleLowerCase().includes(needle)
    })
    return features.length > 0 ? [{ ...row, features }] : []
  })
}

function tally(row: Exclude<ReleaseBoardRow, { kind: 'nothing-recorded' }>): string {
  const parts = [
    row.counts.done ? `${row.counts.done} done` : '',
    row.counts.built ? `${row.counts.built} built` : '',
    row.counts.you ? `${row.counts.you} waiting on you` : '',
    row.counts.building ? `${row.counts.building} being built` : '',
    row.counts.notstarted ? `${row.counts.notstarted} not started` : ''
  ].filter(Boolean)
  return row.collapsed ? `${row.counts.done} done — nothing needs you` : parts.join(' · ')
}
