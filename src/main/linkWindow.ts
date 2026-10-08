import type { DeepLinkArrival } from './deepLinkResolve'
import { requestIdentity } from '../shared/requestIdentity'
import type { RequestMode } from './qa/types'
import type { WindowLayoutPreferences } from './viewState'
import { NARROW_WIDTH, WIDE_WIDTH, fitToWorkArea, type WindowBounds } from './windowLayout'

/**
 * Which window a dtc:// link opens: "when commenting on
 * design or roadmap big, when testing a new feature - sidebar".
 *
 * - A test request (light or detailed) opens as the reviewer's usual sidebar: the narrow,
 *   pinned strip beside the app under test.
 * - Everything else the reviewer reads or comments on (a document review, a roadmap
 *   idea, a thread, a spec, a project) opens big and unpinned.
 * Both are focus mode: the narrow window always is, and the renderer puts a
 * link-born window into focus mode on landing.
 */
export type LinkWindowShape = 'sidebar' | 'big'

export function linkWindowShape(
  arrival: DeepLinkArrival,
  runs: ReadonlyArray<{ request: { path: string; mode?: RequestMode } }>,
  recordRoot: string,
  /** The file's own `kind`/`mode`, read when the scan does not have it yet. */
  fallbackMode?: RequestMode
): LinkWindowShape {
  if (arrival.kind !== 'record')
    return arrival.kind === 'project' || arrival.kind === 'thread' ? 'big' : 'sidebar'
  // Match by the record's canonical identity, the path relative to the record
  // root, as the landing does. Comparing absolute paths misses a request whose
  // link spells the path differently, and it then opens big.
  const run = runs.find(
    (candidate) => requestIdentity(recordRoot, candidate.request.path) === arrival.relative
  )
  if (run) return run.request.mode === 'doc-review' ? 'big' : 'sidebar'
  // A request filed moments ago may not be in the scan yet. A file directly in the
  // project folder, or one round folder down, is a request; its own header
  // says whether it is a review.
  const within = arrival.relative.split('/').slice(1)
  const reserved = ['releases', 'roadmap', 'handoffs', 'threads']
  const isRequestFile = within.length <= 2 && !reserved.includes(within[0] ?? '')
  if (!isRequestFile) return 'big'
  return fallbackMode === 'doc-review' ? 'big' : 'sidebar'
}

/** A request's mode from its frontmatter text: `kind: doc-review` makes it a review. */
export function modeFromFrontmatter(text: string): RequestMode | undefined {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return undefined
  if (/^kind:\s*doc-review\s*$/m.test(match[1])) return 'doc-review'
  const mode = match[1].match(/^mode:\s*(light|test)\s*$/m)?.[1]
  return mode === 'light' || mode === 'test' ? mode : 'test'
}

/** The big window: the expanded width, the full height of the work area, centred, on screen. */
export function bigLinkBounds(workArea: WindowBounds): WindowBounds {
  const width = Math.min(WIDE_WIDTH, workArea.width)
  return fitToWorkArea(
    {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: workArea.y,
      width,
      height: workArea.height
    },
    workArea
  )
}

interface NewWindowState {
  layout: WindowLayoutPreferences
  bounds?: WindowBounds
  preventPinnedOverlap?: true
}

/**
 * The sidebar window: the narrow, pinned strip, whatever window it cascades from.
 *
 * A new window copies the focused window's layout and bounds. When that is a
 * big link window, the copy is big too, and the reviewer's "always pin" setting then pins
 * it: big AND pinned. The sidebar shape is
 * therefore imposed here, not inherited: narrow width, free placement, pinned,
 * kept at the right edge of the footprint the cascade chose, height kept, on
 * screen. A window that already cascades as a narrow strip keeps its place and
 * its overlap guard (a new pinned window exactly over its source is unpinned).
 */
export function sidebarLinkState(state: NewWindowState, workArea: WindowBounds): NewWindowState {
  const width = Math.min(NARROW_WIDTH, workArea.width)
  const layout: WindowLayoutPreferences = {
    ...state.layout,
    widthPreset: 'narrow',
    windowMode: 'free',
    pinned: state.preventPinnedOverlap !== true
  }
  if (!state.bounds) return { ...state, layout }
  if (state.bounds.width <= width) return { ...state, layout }
  const bounds = fitToWorkArea(
    { ...state.bounds, x: state.bounds.x + state.bounds.width - width, width },
    workArea
  )
  return { layout: { ...layout, pinned: true }, bounds }
}

/**
 * A saved window slot given the link's shape. A link that opens in a reopened
 * window (every window had been closed) or in the cold-launch window lands in a
 * slot holding the last window's layout and bounds, so a request opened wide
 * whenever the last window the reviewer closed was wide, whatever spelling the link used.
 * The shape is imposed here exactly as for a new window: the
 * sidebar is narrow, pinned and free; the big window is wide, unpinned and free.
 */
export function slotForLinkShape(
  state: { layout: WindowLayoutPreferences; bounds?: WindowBounds },
  shape: LinkWindowShape,
  workArea: WindowBounds
): { layout: WindowLayoutPreferences; bounds?: WindowBounds } {
  if (shape === 'big') {
    return {
      layout: { ...state.layout, widthPreset: 'wide', windowMode: 'free', pinned: false },
      bounds: bigLinkBounds(workArea)
    }
  }
  const next = sidebarLinkState({ layout: state.layout, bounds: state.bounds }, workArea)
  return { layout: next.layout, ...(next.bounds ? { bounds: next.bounds } : {}) }
}
