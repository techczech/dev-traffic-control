import { describe, expect, test } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import { bodyParts, parentChips, recordIndex } from '../recordChips'

/**
 * A record named in a thread entry becomes a chip showing its title
 * and where it stands. A name that matches nothing in the project stays text.
 */

const NOW = new Date('2026-10-01T12:00:00.000Z')
const ROOT = '/record'

const FIRST = run('2026-09-28-saved-views-and-filters', {
  title: 'Saved views and filters',
  status: 'done',
  completedAt: '2026-09-29T10:00:00.000Z'
})
const LOCK = run('2026-01-29-saved-views-plan', {
  title: 'Saved views and filters: the plan',
  mode: 'doc-review',
  body: '```decision\nLock it?\n- Yes\n```\n```decision\nWhich tray?\n- Drawer\n```'
})
const P12 = run('2026-09-29-preview-12', { title: 'preview.12 check', items: 2 })
const ELSEWHERE = { ...run('2026-09-29-other-project', { title: 'Other' }), project: 'rivermill' }

const snapshot = {
  root: ROOT,
  runs: [FIRST, LOCK, P12, ELSEWHERE],
  notes: [],
  entries: [],
  threads: [
    {
      id: 'saved-views',
      title: 'Saved views thread',
      projects: ['example-app'],
      parents: [],
      move: 'me',
      state: 'open'
    }
  ],
  handoffs: [],
  releases: [],
  pools: [],
  projects: ['example-app', 'rivermill']
} as unknown as QaSnapshot

const index = recordIndex(snapshot, ['example-app'], NOW)

describe('a record named in an entry', () => {
  test('a dtc://open link becomes a chip with the record title and state', () => {
    const parts = bodyParts(
      'It is waiting: [the review](dtc://open/example-app/2026-01-29-saved-views-plan.md) today.',
      index
    )
    expect(parts.map((part) => part.kind)).toEqual(['text', 'chip', 'text'])
    const chip = parts[1].kind === 'chip' ? parts[1].chip : null
    expect(chip?.title).toBe('Saved views and filters: the plan')
    expect(chip?.state).toBe('Waiting on you · 2 decisions, 0 decided')
    expect(chip?.tone).toBe('wait')
    expect(chip?.target).toEqual({
      kind: 'runner',
      path: `${ROOT}/example-app/2026-01-29-saved-views-plan.md`
    })
  })

  test('a bare dtc:// link and a bare file name both resolve', () => {
    const parts = bodyParts(
      'See dtc://open/example-app/2026-09-29-preview-12.md and 2026-09-28-saved-views-and-filters.',
      index
    )
    const chips = parts.flatMap((part) => (part.kind === 'chip' ? [part.chip] : []))
    expect(chips.map((chip) => [chip.title, chip.state])).toEqual([
      ['preview.12 check', 'Waiting on you · 2 checks, 0 done'],
      ['Saved views and filters', 'Answered 29 Sep']
    ])
    // The full stop after the name is the sentence's.
    expect(parts[parts.length - 1]).toEqual({ kind: 'text', text: '.' })
  })

  test('a chip that closes its own brackets drops the brackets', () => {
    const parts = bodyParts(
      'waiting for the plan (review 2026-01-29-saved-views-plan) today',
      index
    )
    expect(parts.map((part) => (part.kind === 'text' ? part.text : part.chip.title))).toEqual([
      'waiting for the plan review ',
      'Saved views and filters: the plan',
      ' today'
    ])
  })

  test('a name with no record in the project stays as written', () => {
    const body = 'Look at 2026-09-29-other-project and dtc://open/example-app/2026-01-01-gone.md.'
    expect(bodyParts(body, index)).toEqual([{ kind: 'text', text: body }])
  })

  test('a thread link opens the thread', () => {
    const parts = bodyParts('Continued in dtc://thread/example-app/saved-views', index)
    const chip = parts.find((part) => part.kind === 'chip')
    expect(chip?.kind === 'chip' && chip.chip.state).toBe('Waiting on you')
  })

  test('a date inside some other link address is not read as a record name', () => {
    const body = '[notes](https://example.test/2026-09-29-preview-12)'
    expect(bodyParts(body, index)).toEqual([{ kind: 'text', text: body }])
  })
})

test('parents become chips when they name a record, else stay plain names', () => {
  const parents = parentChips(
    ['2026-09-28-saved-views-and-filters', 'saved-views', 'nothing'],
    index
  )
  expect(parents.map(({ name, chip }) => [name, chip?.title ?? null])).toEqual([
    ['2026-09-28-saved-views-and-filters', 'Saved views and filters'],
    ['saved-views', 'Saved views thread'],
    ['nothing', null]
  ])
})

function run(
  base: string,
  options: {
    title: string
    status?: 'waiting' | 'done'
    completedAt?: string
    mode?: 'test' | 'doc-review'
    body?: string
    items?: number
  }
): SerializableRun {
  const mode = options.mode ?? 'test'
  return {
    request: {
      id: base,
      title: options.title,
      labels: {},
      mode,
      items: Array.from({ length: options.items ?? 0 }, (_, i) => ({
        id: `i${i}`,
        title: `i${i}`,
        steps: [],
        expected: [],
        notes: []
      })),
      parked: [],
      degraded: false,
      raw: options.body ?? '',
      path: `${ROOT}/example-app/${base}.md`,
      ...(mode === 'doc-review'
        ? { document: { headings: [], bodyMarkdown: options.body ?? '' } }
        : {})
    },
    requestMtime: '2026-09-29T09:00:00.000Z',
    report: options.completedAt
      ? ({
          id: base,
          title: options.title,
          startedAt: '',
          completedAt: options.completedAt,
          items: []
        } as unknown as SerializableRun['report'])
      : null,
    status: options.status ?? 'waiting',
    project: 'example-app',
    round: null
  } as SerializableRun
}
