import { describe, expect, test } from 'vitest'
import { confineArchiveOld } from '../archiveOld'
import { confineHandoffPath } from '../confinement'
import type { QaSnapshot } from '../../shared/ipc'

const snapshot = {
  root: '/record',
  runs: [{ request: { path: '/record/tallyboard/2026-08-01-old.md' } }],
  threads: [{ id: 'thread-a' }],
  handoffs: [{ path: '/record/tallyboard/handoffs/2026-08-01-x-handoff.md' }]
} as unknown as QaSnapshot

describe('archive old keeps only what the snapshot holds (ticket 22)', () => {
  test('known requests, threads and handoffs pass', () => {
    expect(
      confineArchiveOld(
        {
          requests: ['tallyboard/2026-08-01-old.md'],
          threads: ['thread-a'],
          handoffs: ['/record/tallyboard/handoffs/2026-08-01-x-handoff.md']
        },
        snapshot
      )
    ).toEqual({
      requests: ['tallyboard/2026-08-01-old.md'],
      threads: ['thread-a'],
      handoffs: ['/record/tallyboard/handoffs/2026-08-01-x-handoff.md']
    })
  })

  test('a handoff path not in the snapshot is dropped, so nothing is written there', () => {
    expect(
      confineArchiveOld(
        { requests: [], threads: [], handoffs: ['/etc/passwd', '/record/../elsewhere-handoff.md'] },
        snapshot
      ).handoffs
    ).toEqual([])
  })

  test('unknown ids, junk types and duplicates are dropped', () => {
    const confined = confineArchiveOld(
      {
        requests: ['nope.md', 'tallyboard/2026-08-01-old.md', 'tallyboard/2026-08-01-old.md'],
        threads: [42 as unknown as string, 'thread-z'],
        handoffs: 'not-an-array' as unknown as string[]
      },
      snapshot
    )
    expect(confined).toEqual({
      requests: ['tallyboard/2026-08-01-old.md'],
      threads: [],
      handoffs: []
    })
  })

  test('no snapshot archives nothing', () => {
    expect(confineArchiveOld({ requests: ['a'], threads: ['b'], handoffs: ['c'] }, null)).toEqual({
      requests: [],
      threads: [],
      handoffs: []
    })
  })
})

describe('one confinement gate for every renderer-initiated handoff write', () => {
  const scanned = '/record/tallyboard/handoffs/2026-08-01-x-handoff.md'

  test('a path exactly equal to a scanned handoff passes', () => {
    expect(confineHandoffPath(scanned, snapshot)).toBe(scanned)
  })

  test('an unknown path is refused', () => {
    expect(confineHandoffPath('/record/tallyboard/handoffs/other-handoff.md', snapshot)).toBeNull()
  })

  test('a non-string is refused', () => {
    expect(confineHandoffPath(42, snapshot)).toBeNull()
    expect(confineHandoffPath({ path: scanned }, snapshot)).toBeNull()
    expect(confineHandoffPath(undefined, snapshot)).toBeNull()
  })

  test('no snapshot refuses everything', () => {
    expect(confineHandoffPath(scanned, null)).toBeNull()
  })

  test('a traversal string that resolves outside the record is refused', () => {
    expect(confineHandoffPath('/record/x/../../etc/passwd', snapshot)).toBeNull()
    expect(
      confineHandoffPath(
        '/record/tallyboard/handoffs/../handoffs/2026-08-01-x-handoff.md',
        snapshot
      )
    ).toBeNull()
  })

  test('the path of a scanned request, not a handoff, is refused', () => {
    expect(confineHandoffPath('/record/tallyboard/2026-08-01-old.md', snapshot)).toBeNull()
  })
})
