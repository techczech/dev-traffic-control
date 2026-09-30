import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, ChevronDown, Clock, List, Plug } from 'lucide-react'
import { useApp } from '../state/app'
import { ArchiveOld } from '../components/ArchiveOld'
import { useCommandScope } from '../commands/provider'
import { requestKey } from '../lib/inbox'
import {
  FLEET_SORTS,
  FLEET_SORT_LABELS,
  FLEET_SORT_STORAGE_KEY,
  fleetOverview,
  handoffPanel,
  readFleetSort,
  writeFleetSort,
  type FleetSort,
  type FleetTarget
} from '../lib/fleet'

/** Each column header re-sorts by what it heads. */
const COLUMNS: Array<{ label: string; sort: FleetSort }> = [
  { label: 'Project', sort: 'name' },
  { label: 'Release', sort: 'release' },
  { label: 'What it owes', sort: 'most-owed' },
  { label: 'Last', sort: 'last-moved' }
]

/**
 * Overview under *All projects* — the fleet (mockup state 17). The count of
 * what he owes, one line per project saying where it stands, and beside it the
 * handoffs sitting ready and the latest movement across the fleet. A project
 * name opens that project; nothing here is a project home in miniature.
 */
export function FleetOverview(): React.JSX.Element {
  const { snapshot, navigate, setScope, markSeen, housekeeping } = useApp()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [sort, setSortValue] = useState<FleetSort>(() => readFleetSort())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const model = useMemo(
    () => (snapshot ? fleetOverview(snapshot, now, sort, undefined, housekeeping) : null),
    [snapshot, now, sort, housekeeping]
  )

  const setSort = (next: FleetSort): void => {
    setSortValue(next)
    writeFleetSort(FLEET_SORT_STORAGE_KEY, next)
  }

  const openProject = (slug: string): void => setScope({ kind: 'project', slug })
  const openTarget = (target: FleetTarget): void => {
    if (target.kind === 'runner') {
      markSeen(requestKey(snapshot?.root ?? '', target.path))
      navigate({ kind: 'runner', path: target.path })
    } else if (target.kind === 'thread') {
      navigate({ kind: 'thread', project: target.project, thread: target.thread })
    } else {
      openProject(target.slug)
    }
  }

  // The panel draws the newest few; the header and the tile keep the full count.
  const panel = useMemo(() => handoffPanel(model?.handoffs ?? []), [model])

  const selectable = useMemo(
    () =>
      model
        ? [
            ...model.rows.map((row) => `project:${row.slug}`),
            ...panel.shown.map((handoff) => `handoff:${handoff.path}`),
            ...model.latest.map((event) => `latest:${event.key}`)
          ]
        : [],
    [model, panel]
  )
  const activeKey =
    selectedKey && selectable.includes(selectedKey) ? selectedKey : (selectable[0] ?? null)
  const activeIndex = activeKey ? selectable.indexOf(activeKey) : -1

  const openSelected = (): void => {
    if (!model || !activeKey) return
    const [kind, ...rest] = activeKey.split(':')
    const id = rest.join(':')
    if (kind === 'project') openProject(id)
    else if (kind === 'handoff') {
      const handoff = panel.shown.find((candidate) => candidate.path === id)
      if (handoff) openProject(handoff.slug)
    } else {
      const event = model.latest.find((candidate) => candidate.key === id)
      if (event) openTarget(event.target)
    }
  }

  useCommandScope({
    'nav.move-down': {
      enabled: selectable.length > 0,
      handler: () =>
        setSelectedKey(selectable[Math.min(activeIndex + 1, selectable.length - 1)] ?? null)
    },
    'nav.move-up': {
      enabled: selectable.length > 0,
      handler: () => setSelectedKey(selectable[Math.max(activeIndex - 1, 0)] ?? null)
    },
    'nav.open-selection': { enabled: !!activeKey, handler: openSelected }
  })

  if (!model) return <div className="view fleet" />

  const { tiles } = model
  const focused = (key: string): string => (activeKey === key ? ' focused' : '')

  return (
    <div className="view fleet">
      <div className="fleet-scroll">
        {/* Ticket 34: how to connect agents, always one click from the Dash. */}
        <div className="fleet-toolbar">
          <button
            type="button"
            className="fleet-get-started"
            onClick={() => navigate({ kind: 'get-started' })}
          >
            <Plug className="ic" strokeWidth={2} />
            Get started
          </button>
        </div>
        <div className="fleet-tiles">
          <div className={`fleet-tile${tiles.waiting > 0 ? ' pull' : ''}`}>
            <div className="n">{tiles.waiting}</div>
            <div className="l">waiting on you</div>
          </div>
          <div className="fleet-tile">
            <div className="n">{tiles.releasesInFlight}</div>
            <div className="l">release{tiles.releasesInFlight === 1 ? '' : 's'} in flight</div>
          </div>
          <div className="fleet-tile">
            <div className="n">{tiles.handoffsReady}</div>
            <div className="l">handoff{tiles.handoffsReady === 1 ? '' : 's'} ready</div>
          </div>
          <div className="fleet-tile">
            <div className="n">{tiles.projects}</div>
            <div className="l">
              project{tiles.projects === 1 ? '' : 's'}
              {tiles.synced ? ` · synced ${tiles.synced}` : ''}
            </div>
          </div>
        </div>

        <div className="fleet-cols">
          <section className="fleet-card" aria-label="Where each project stands">
            <header>
              <List className="ic" strokeWidth={2} />
              Where each project stands
              <span className="n">
                <ArchiveOld scope={{ kind: 'all' }} />
                <label className="fleet-sort">
                  <Clock className="ic" strokeWidth={2} />
                  <select
                    aria-label="Sort projects"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as FleetSort)}
                  >
                    {FLEET_SORTS.map((option) => (
                      <option key={option} value={option}>
                        {FLEET_SORT_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="ic chev" strokeWidth={2} />
                </label>
              </span>
            </header>
            <div className="fleet-fr hd">
              {COLUMNS.map((column) => (
                <button
                  key={column.sort}
                  type="button"
                  className={sort === column.sort ? 'on' : ''}
                  aria-pressed={sort === column.sort}
                  title={`Sort by ${FLEET_SORT_LABELS[column.sort].toLocaleLowerCase()}`}
                  onClick={() => setSort(sort === column.sort ? 'needs-you' : column.sort)}
                >
                  {column.label}
                </button>
              ))}
            </div>
            {model.rows.length === 0 ? (
              <div className="rowempty">No projects in the record yet.</div>
            ) : (
              model.rows.map((row) => (
                <button
                  key={row.slug}
                  type="button"
                  className={`fleet-fr${focused(`project:${row.slug}`)}`}
                  data-fleet-row={row.slug}
                  onFocus={() => setSelectedKey(`project:${row.slug}`)}
                  onClick={() => openProject(row.slug)}
                >
                  <span className="nm">{row.name}</span>
                  <span className="age">{row.release || '—'}</span>
                  <span className={row.needsYou ? 'owes' : 'quiet'}>{row.owes}</span>
                  <span className="age">{row.last || '—'}</span>
                </button>
              ))
            )}
          </section>

          <div className="fleet-side">
            <section className="fleet-card" aria-label="Handoffs ready">
              <header>
                <ArrowRightLeft className="ic" strokeWidth={2} />
                Handoffs ready
                <span className="n">{model.handoffs.length}</span>
              </header>
              {model.handoffs.length === 0 ? (
                <div className="rowempty">No handoff is waiting to be picked up.</div>
              ) : (
                <div className="fleet-rows">
                  {panel.shown.map((handoff) => (
                    <button
                      key={handoff.path}
                      type="button"
                      className={`fleet-r${focused(`handoff:${handoff.path}`)}`}
                      onFocus={() => setSelectedKey(`handoff:${handoff.path}`)}
                      onClick={() => openProject(handoff.slug)}
                    >
                      <span className="t">
                        <em>{handoff.name}</em> · {handoff.title}
                      </span>
                      <span className="age">{handoff.age}</span>
                    </button>
                  ))}
                  {panel.moreLabel && (
                    <div className="fleet-r more" data-fleet-handoffs-more>
                      <span className="t">{panel.moreLabel}</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="fleet-card" aria-label="Latest across the fleet">
              <header>
                <Clock className="ic" strokeWidth={2} />
                Latest
                <span className="n">across the fleet</span>
              </header>
              {model.latest.length === 0 ? (
                <div className="rowempty">Nothing has moved yet.</div>
              ) : (
                <div className="fleet-rows">
                  {model.latest.map((event) => (
                    <button
                      key={event.key}
                      type="button"
                      className={`fleet-r${focused(`latest:${event.key}`)}`}
                      onFocus={() => setSelectedKey(`latest:${event.key}`)}
                      onClick={() => openTarget(event.target)}
                    >
                      <span className="t">
                        <em>{event.name}</em> · {event.text}
                      </span>
                      <span className="age">{event.age}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
