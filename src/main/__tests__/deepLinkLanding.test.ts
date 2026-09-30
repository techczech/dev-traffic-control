import { expect, test } from 'vitest'
import { landingForArrival, type LandingRecords } from '../deepLinkResolve'

// Dominik 2026-09-26: links "don't open on the thing but in the dash". A
// release, roadmap idea, handoff or thread entry now opens on itself.
const records: LandingRecords = {
  recordRoot: '/r',
  runPaths: ['/r/tw/2026-09-26-a-check.md'],
  notePaths: [],
  threadIds: ['tw-thread'],
  handoffPaths: ['/r/tw/handoffs/2026-09-26-x-handoff.md'],
  entries: [{ path: '/r/tw/threads/2026-09-26-1200-entry-one.md', thread: 'tw-thread' }]
}
const record = (relative: string, fragment?: string) =>
  ({
    kind: 'record',
    project: 'tw',
    relative,
    path: `/private/r/${relative}`,
    ...(fragment ? { fragment } : {})
  }) as const
const land = (relative: string, fragment?: string) =>
  landingForArrival(record(relative, fragment), 'dtc://x', false, records)

test('a release record opens Releases at that version, and at the feature when one is named', () => {
  expect(land('tw/releases/0.34.0.md', 'handout-fix')).toMatchObject({
    kind: 'opened',
    view: { kind: 'release', version: '0.34.0', feature: 'handout-fix' }
  })
  expect(land('tw/releases/0.34.0.md')).toMatchObject({
    view: { kind: 'release', version: '0.34.0' }
  })
})

test('a roadmap idea opens Roadmap on that idea; the order file does not', () => {
  expect(land('tw/roadmap/faster-export.md')).toMatchObject({
    view: { kind: 'roadmap', idea: 'faster-export' }
  })
  expect(land('tw/roadmap/order.md')).toMatchObject({ view: { kind: 'project', slug: 'tw' } })
})

test('a handoff opens Handoffs on that handoff', () => {
  expect(land('tw/handoffs/2026-09-26-x-handoff.md')).toMatchObject({
    view: { kind: 'handoff', path: '/r/tw/handoffs/2026-09-26-x-handoff.md' }
  })
})

test('a thread entry opens its thread', () => {
  expect(land('tw/threads/2026-09-26-1200-entry-one.md')).toMatchObject({
    view: { kind: 'thread', project: 'tw', thread: 'tw-thread' }
  })
})

test('requests still open the request, and anything else lands on the project', () => {
  expect(land('tw/2026-09-26-a-check.md')).toMatchObject({ view: { kind: 'runner' } })
  expect(land('tw/AGENTS.md')).toMatchObject({ view: { kind: 'project', slug: 'tw' } })
})
