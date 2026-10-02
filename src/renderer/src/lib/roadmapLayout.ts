/**
 * What the Roadmap remembers on this machine (ticket 42): which layout he
 * chose, and the version he typed into the fallback "Start a new pending
 * release" when no release record exists to derive one from. Per-viewer
 * conveniences only; every read and write is guarded.
 */

export type RoadmapLayout = 'columns' | 'list' | 'tiers'

export const ROADMAP_LAYOUTS: ReadonlyArray<{ id: RoadmapLayout; label: string }> = [
  { id: 'columns', label: 'Columns' },
  { id: 'list', label: 'List' },
  { id: 'tiers', label: 'Tiers' }
]

const LAYOUT_KEY = 'dtc.roadmap.layout.v1'
const STARTED_KEY = 'dtc.roadmap.started-pending.v1'

export function readRoadmapLayout(): RoadmapLayout {
  try {
    const stored = window.localStorage.getItem(LAYOUT_KEY)
    if (stored === 'columns' || stored === 'list' || stored === 'tiers') return stored
  } catch {
    // Storage can be unavailable; the default layout applies.
  }
  return 'columns'
}

export function writeRoadmapLayout(layout: RoadmapLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // Not remembered; the choice still holds for this session.
  }
}

/** The layout after this one, for the one-key switch. */
export function nextRoadmapLayout(layout: RoadmapLayout): RoadmapLayout {
  const order = ROADMAP_LAYOUTS.map((entry) => entry.id)
  return order[(order.indexOf(layout) + 1) % order.length]
}

export function readStartedPending(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STARTED_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  } catch {
    return {}
  }
}

export function writeStartedPending(project: string, version: string): Record<string, string> {
  const next = { ...readStartedPending(), [project]: version }
  try {
    window.localStorage.setItem(STARTED_KEY, JSON.stringify(next))
  } catch {
    // Not remembered across launches.
  }
  return next
}
