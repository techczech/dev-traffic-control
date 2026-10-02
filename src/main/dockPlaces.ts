import type { DockEdge, DockMenuState, DockPlaceId } from '../shared/ipc'
import type { WindowBounds } from './windowLayout'

/**
 * Where the Dock button puts the sidebar: the
 * right or left edge, of the screen the window is on or of the other screen.
 *
 * "This screen" is the display the window is on when he chooses; "other
 * screen" is the next display in Electron's order. A choice is remembered as
 * an edge and a display id, so the main part of the button can dock at the
 * same place again. When the remembered display has gone, docking falls back
 * to the same edge of the window's current display.
 *
 * Everything here is pure: the caller supplies the displays and the window's
 * current display, and applies the bounds it gets back.
 */
export interface DockDisplay {
  id: number
  workArea: WindowBounds
}

/** A dock place as remembered across launches. */
export interface RememberedDockPlace {
  edge: DockEdge
  displayId: number
}

/** The display after `currentId`, wrapping; `undefined` with one display. */
export function otherDisplay(
  displays: readonly DockDisplay[],
  currentId: number
): DockDisplay | undefined {
  if (displays.length < 2) return undefined
  const index = displays.findIndex((display) => display.id === currentId)
  return displays[(index + 1) % displays.length]
}

function parsePlace(place: DockPlaceId): { edge: DockEdge; other: boolean } {
  const [edge, screen] = place.split('-') as [DockEdge, 'this' | 'other']
  return { edge, other: screen === 'other' }
}

/**
 * Turn a menu choice into the place to remember. "Other screen" with one
 * display is disabled in the menu; if it arrives anyway it means this screen.
 */
export function resolveDockPlace(
  place: DockPlaceId,
  displays: readonly DockDisplay[],
  currentId: number
): RememberedDockPlace {
  const { edge, other } = parsePlace(place)
  const target = other ? otherDisplay(displays, currentId) : undefined
  return { edge, displayId: target?.id ?? currentId }
}

/**
 * The sidebar at `place`: sidebar width (never wider than the screen), the
 * full height of the work area, flush with that edge. A remembered display
 * that is no longer connected falls back to the same edge of the current one.
 */
export function dockBounds(
  place: RememberedDockPlace,
  displays: readonly DockDisplay[],
  currentDisplayId: number,
  sidebarWidth: number
): { bounds: WindowBounds; displayId: number } {
  const display =
    displays.find((candidate) => candidate.id === place.displayId) ??
    displays.find((candidate) => candidate.id === currentDisplayId) ??
    displays[0]
  const workArea = display.workArea
  const width = Math.min(sidebarWidth, workArea.width)
  const x = place.edge === 'left' ? workArea.x : workArea.x + workArea.width - width
  return {
    bounds: { x, y: workArea.y, width, height: workArea.height },
    displayId: display.id
  }
}

const PLACE_ORDER: readonly DockPlaceId[] = ['right-this', 'left-this', 'right-other', 'left-other']

/** Clicks on the Dock button closer together than this are one cycling run (ticket 41). */
export const DOCK_REPEAT_MS = 4000

/**
 * A run of repeated clicks on the Dock button's main part. The four places are
 * named from the screen the run started on, because after one step to the other
 * screen the window's "this screen" has changed under it.
 */
export interface DockCycle {
  /** When the last click of the run happened. */
  at: number
  /** The place that click docked at. */
  place: DockPlaceId
  /** The display the run started on. */
  originId: number
}

/**
 * What a click on the Dock button's main part does. The first click, or one
 * more than `DOCK_REPEAT_MS` after the previous, docks at the last-used place
 * (as before ticket 41). A repeat steps to the next of the four places in the
 * order right/this, left/this, right/other, left/other, wrapping; with one
 * display it alternates right and left. Pure: the caller keeps `cycle` and
 * resets it (null) on any other window action.
 */
export function dockClickStep(
  cycle: DockCycle | null,
  now: number,
  remembered: RememberedDockPlace | null,
  displays: readonly DockDisplay[],
  currentId: number
): { target: RememberedDockPlace; cycle: DockCycle } {
  const repeated = cycle !== null && now - cycle.at <= DOCK_REPEAT_MS && now >= cycle.at
  if (!repeated) {
    const last = remembered ?? defaultDockPlace(currentId)
    const place = placeIdFor(last, displays, currentId)
    return { target: last, cycle: { at: now, place, originId: currentId } }
  }
  const hasOther = otherDisplay(displays, cycle.originId) !== undefined
  const available = PLACE_ORDER.filter((id) => hasOther || id.endsWith('-this'))
  const at = available.indexOf(cycle.place)
  const place = available[(at + 1) % available.length]
  return {
    target: resolveDockPlace(place, displays, cycle.originId),
    cycle: { at: now, place, originId: cycle.originId }
  }
}

const PLACE_LABEL: Record<DockPlaceId, string> = {
  'right-this': 'Right edge · this screen',
  'left-this': 'Left edge · this screen',
  'right-other': 'Right edge · other screen',
  'left-other': 'Left edge · other screen'
}

/**
 * The remembered place seen from the window's current display: which of the
 * four menu places it is. A remembered display that is gone reads as the same
 * edge of this screen, which is where docking would put it.
 */
export function placeIdFor(
  remembered: RememberedDockPlace,
  displays: readonly DockDisplay[],
  currentId: number
): DockPlaceId {
  const other = otherDisplay(displays, currentId)
  const onOther = remembered.displayId !== currentId && remembered.displayId === other?.id
  return `${remembered.edge}-${onOther ? 'other' : 'this'}`
}

/** The ▾ menu: four places, the two "other screen" ones disabled with one display. */
export function dockMenuState(
  remembered: RememberedDockPlace | null,
  displays: readonly DockDisplay[],
  currentId: number
): DockMenuState {
  const hasOther = otherDisplay(displays, currentId) !== undefined
  const last = placeIdFor(remembered ?? defaultDockPlace(currentId), displays, currentId)
  return {
    last,
    places: PLACE_ORDER.map((id) => ({
      id,
      label: PLACE_LABEL[id],
      enabled: hasOther || id.endsWith('-this'),
      current: id === last
    }))
  }
}

/** Before he has ever docked: the right edge of the window's own screen. */
export function defaultDockPlace(currentId: number): RememberedDockPlace {
  return { edge: 'right', displayId: currentId }
}

export function isDockPlaceId(value: unknown): value is DockPlaceId {
  return typeof value === 'string' && (PLACE_ORDER as readonly string[]).includes(value)
}

export function isRememberedDockPlace(value: unknown): value is RememberedDockPlace {
  if (typeof value !== 'object' || value === null) return false
  const { edge, displayId } = value as Record<string, unknown>
  return (edge === 'left' || edge === 'right') && typeof displayId === 'number'
}
