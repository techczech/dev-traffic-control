import { expect, test } from 'vitest'
import { landingForArrival, type LandingRecords } from '../deepLinkResolve'

// Links open on the thing, not in the dash. A
// release, roadmap idea, handoff or thread entry now opens on itself.
const records: LandingRecords = {
  recordRoot: '/r',
  runPaths: ['/r/sketchpad/2026-09-26-a-check.md'],
  notePaths: [],
  threadIds: ['sketchpad-thread'],
  handoffPaths: ['/r/sketchpad/handoffs/2026-09-26-x-handoff.md'],
  entries: [
    { path: '/r/sketchpad/threads/2026-09-26-1200-entry-one.md', thread: 'sketchpad-thread' }
  ]
}
const record = (relative: string, fragment?: string) =>
  ({
    kind: 'record',
    project: 'sketchpad',
    relative,
    path: `/private/r/${relative}`,
    ...(fragment ? { fragment } : {})
  }) as const
const land = (relative: string, fragment?: string) =>
  landingForArrival(record(relative, fragment), 'dtc://x', false, records)

test('a release record opens Releases at that version, and at the feature when one is named', () => {
  expect(land('sketchpad/releases/0.34.0.md', 'handout-fix')).toMatchObject({
    kind: 'opened',
    view: { kind: 'release', version: '0.34.0', feature: 'handout-fix' }
  })
  expect(land('sketchpad/releases/0.34.0.md')).toMatchObject({
    view: { kind: 'release', version: '0.34.0' }
  })
})

test('a roadmap idea opens Roadmap on that idea; the order file does not', () => {
  expect(land('sketchpad/roadmap/faster-export.md')).toMatchObject({
    view: { kind: 'roadmap', idea: 'faster-export' }
  })
  expect(land('sketchpad/roadmap/order.md')).toMatchObject({
    view: { kind: 'project', slug: 'sketchpad' }
  })
})

test('a handoff opens Handoffs on that handoff', () => {
  expect(land('sketchpad/handoffs/2026-09-26-x-handoff.md')).toMatchObject({
    view: { kind: 'handoff', path: '/r/sketchpad/handoffs/2026-09-26-x-handoff.md' }
  })
})

test('a thread entry opens its thread', () => {
  expect(land('sketchpad/threads/2026-09-26-1200-entry-one.md')).toMatchObject({
    view: { kind: 'thread', project: 'sketchpad', thread: 'sketchpad-thread' }
  })
})

test('requests still open the request, and anything else lands on the project', () => {
  expect(land('sketchpad/2026-09-26-a-check.md')).toMatchObject({ view: { kind: 'runner' } })
  expect(land('sketchpad/AGENTS.md')).toMatchObject({
    view: { kind: 'project', slug: 'sketchpad' }
  })
})
