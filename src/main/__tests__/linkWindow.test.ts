import { expect, test } from 'vitest'
import { bigLinkBounds, linkWindowShape } from '../linkWindow'
import { NARROW_WIDTH, WIDE_WIDTH } from '../windowLayout'

const runs = [
  { request: { path: '/r/dtc/test.md', mode: 'light' as const } },
  { request: { path: '/r/dtc/detailed.md', mode: 'test' as const } },
  { request: { path: '/r/dtc/design.md', mode: 'doc-review' as const } }
]
// The arrival carries the path relative to the record root, as the resolver
// makes it; its absolute path need not equal the scan's string (the alpha.19
// bug: a test request opened big because absolute paths were compared).
const record = (path: string) =>
  ({
    kind: 'record',
    project: 'dtc',
    relative: path.replace(/^\/r\//, ''),
    path: `/private${path}`
  }) as const

test('testing a feature opens the sidebar', () => {
  expect(linkWindowShape(record('/r/dtc/test.md'), runs, '/r')).toBe('sidebar')
  expect(linkWindowShape(record('/r/dtc/detailed.md'), runs, '/r')).toBe('sidebar')
})

test('commenting on a design, a roadmap idea, a thread or a project opens big', () => {
  expect(linkWindowShape(record('/r/dtc/design.md'), runs, '/r')).toBe('big')
  expect(linkWindowShape(record('/r/dtc/roadmap/an-idea.md'), runs, '/r')).toBe('big')
  expect(linkWindowShape({ kind: 'thread', project: 'dtc', thread: 't' }, runs, '/r')).toBe('big')
  expect(linkWindowShape({ kind: 'project', project: 'dtc' }, runs, '/r')).toBe('big')
})

test('a refused or unsynced link keeps the usual sidebar', () => {
  expect(linkWindowShape({ kind: 'refused' }, runs, '/r')).toBe('sidebar')
  expect(linkWindowShape({ kind: 'behind', project: 'dtc' }, runs, '/r')).toBe('sidebar')
})

test('the big window is the expanded width, full height, centred and on screen', () => {
  const wa = { x: 0, y: 25, width: 1728, height: 1080 }
  expect(bigLinkBounds(wa)).toEqual({ x: 224, y: 25, width: WIDE_WIDTH, height: 1080 })
  const small = { x: 0, y: 25, width: 1024, height: 700 }
  expect(bigLinkBounds(small)).toEqual({ x: 0, y: 25, width: 1024, height: 700 })
})

// 2026-09-27: a test request filed moments ago opened big, because the scan
// did not have it yet. The file's own header now decides.
test('a request not yet in the scan opens by its own header', () => {
  const fresh = record('/r/dtc/2026-09-27-fresh.md')
  expect(linkWindowShape(fresh, [], '/r', 'light')).toBe('sidebar')
  expect(linkWindowShape(fresh, [], '/r', undefined)).toBe('sidebar')
  expect(linkWindowShape(fresh, [], '/r', 'doc-review')).toBe('big')
  // Reserved folders are never requests.
  expect(linkWindowShape(record('/r/dtc/releases/0.1.0.md'), [], '/r')).toBe('big')
})

test('the header says doc-review, light or test', async () => {
  const { modeFromFrontmatter } = await import('../linkWindow')
  expect(modeFromFrontmatter('---\nid: a\nkind: doc-review\n---\n')).toBe('doc-review')
  expect(modeFromFrontmatter('---\nid: a\nmode: light\n---\n')).toBe('light')
  expect(modeFromFrontmatter('---\nid: a\n---\n')).toBe('test')
  expect(modeFromFrontmatter('no header')).toBeUndefined()
})

// 2026-09-28, alpha.24: with a big link window focused, a test request's new
// window cascaded from it and kept its 1280 width, and "always pin" pinned it:
// big AND pinned. These are the numbers the hidden copy of his setup produced.
test('a test request opened from a big window is still the narrow pinned sidebar', async () => {
  const { sidebarLinkState } = await import('../linkWindow')
  const wa = { x: 0, y: 34, width: 1512, height: 948 }
  const clonedFromBig = {
    layout: { pinned: false, widthPreset: 'wide' as const, windowMode: 'free' as const },
    bounds: { x: 144, y: 34, width: 1280, height: 948 }
  }
  expect(sidebarLinkState(clonedFromBig, wa)).toEqual({
    layout: { pinned: true, widthPreset: 'narrow', windowMode: 'free' },
    bounds: { x: 964, y: 34, width: NARROW_WIDTH, height: 948 }
  })
  // Near the right edge it stays on screen.
  const atEdge = { ...clonedFromBig, bounds: { x: 1400, y: 34, width: 1280, height: 948 } }
  const placed = sidebarLinkState(atEdge, wa).bounds!
  expect(placed.width).toBe(NARROW_WIDTH)
  expect(placed.x + placed.width).toBeLessThanOrEqual(wa.x + wa.width)
})

test('a sidebar cascaded from a sidebar keeps its place and its overlap guard', async () => {
  const { sidebarLinkState } = await import('../linkWindow')
  const wa = { x: 0, y: 34, width: 1512, height: 948 }
  const bounds = { x: 1024, y: 62, width: NARROW_WIDTH, height: 920 }
  const layout = { pinned: true, widthPreset: 'narrow' as const, windowMode: 'free' as const }
  expect(sidebarLinkState({ layout, bounds }, wa)).toEqual({ layout, bounds })
  // Exactly over its source it is not pinned, as for any new window.
  expect(
    sidebarLinkState(
      { layout: { ...layout, pinned: false }, bounds, preventPinnedOverlap: true },
      wa
    )
  ).toEqual({ layout: { ...layout, pinned: false }, bounds, preventPinnedOverlap: true })
  // No source window: the narrow pinned layout, default placement.
  expect(sidebarLinkState({ layout: { ...layout, widthPreset: 'wide' } }, wa)).toEqual({ layout })
})
