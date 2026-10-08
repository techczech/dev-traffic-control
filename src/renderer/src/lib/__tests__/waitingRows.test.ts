import { describe, expect, test } from 'vitest'
import type { SerializableRun } from '../../../../shared/ipc'
import type { Thread, ThreadEntry } from '../../../../main/qa/types'
import {
  WAITING_LAYOUT_LABELS,
  DEFAULT_WAITING_LAYOUT,
  WAITING_LAYOUT_STORAGE_KEY,
  arrangeWaiting,
  countDecisionFences,
  entrySnippet,
  formatWaited,
  humaniseRequestTitle,
  readWaitingLayout,
  waitingForHandoff,
  waitingForRun,
  waitingForThread,
  writeWaitingLayout,
  type WaitingMeta
} from '../waitingRows'

/**
 * The row says what kind of action it is and how much is left of
 * it; the card arranges rows by kind or newest first (labelled Group and Sort) and remembers which. None
 * of this decides what is owed.
 */

const NOW = new Date('2026-10-01T12:00:00.000Z')

describe('a request with no title', () => {
  test('shows its file name as words, the date dropped', () => {
    expect(
      humaniseRequestTitle(
        '2026-09-12-example-app-margin-notes-wrap',
        '/r/example-app/2026-09-12-example-app-margin-notes-wrap.md'
      )
    ).toBe('Example app margin notes wrap')
  })

  test('leaves a real title alone', () => {
    expect(humaniseRequestTitle('Margin notes wrap', '/r/p/2026-09-12-other-name.md')).toBe(
      'Margin notes wrap'
    )
  })
})

describe('the count line of a request', () => {
  test('a check reads "N checks · k done", counting answered items', () => {
    const meta = waitingForRun(
      testRun({ items: ['a', 'b', 'c', 'd'], answered: { a: 'pass' } }),
      '2026-09-27T09:00:00.000Z',
      NOW
    )
    expect([meta.tag, meta.lead + meta.rest, meta.action]).toEqual([
      'Test',
      '4 checks · 1 done',
      'Open'
    ])
    expect(meta.progress).toEqual({ done: 1, total: 4 })
  })

  test('one check is singular', () => {
    expect(waitingForRun(testRun({ items: ['a'] }), '', NOW).lead).toBe('1 check')
  })

  test('a review counts decision fences and takes decided from the report', () => {
    const body = [
      '# Doc',
      '```decision',
      'Q one?',
      '- A',
      '```',
      '',
      '```decision {#second}',
      'Q two?',
      '- B',
      '```'
    ].join('\n')
    expect(countDecisionFences(body)).toBe(2)
    const meta = waitingForRun(
      testRun({
        mode: 'doc-review',
        body,
        decisions: [
          { id: 'one', question: 'Q one?', choice: 'A' },
          { id: 'second', question: 'Q two?', choice: '' }
        ]
      }),
      '2026-09-29T09:00:00.000Z',
      NOW
    )
    expect([meta.tag, meta.lead + meta.rest, meta.action]).toEqual([
      'Decide',
      '2 decisions · 1 decided',
      'Open'
    ])
  })
})

describe('the other kinds', () => {
  test('a handoff says it was never picked up, and when it was written', () => {
    const meta = waitingForHandoff('2026-09-29T09:00:00.000Z', NOW)
    expect([meta.tag, meta.lead + meta.rest, meta.action]).toEqual([
      'Pick up',
      'Never picked up · written 29 Sep',
      'Open'
    ])
  })

  test("every kind's button says only Open: the tag already names the action", () => {
    expect(waitingForHandoff('2026-09-29T09:00:00.000Z', NOW).action).toBe('Open')
    expect(waitingForThread(threadOf(['x']), NOW).action).toBe('Open')
  })

  test('a thread shows its latest entry as one plain line', () => {
    const meta = waitingForThread(
      threadOf([
        'Older entry.',
        '**3 questions:** does she run it,\n\nwhich [sync](https://x.test)?'
      ]),
      NOW
    )
    expect(meta.tag).toBe('Answer')
    expect(meta.snippet).toBe('3 questions: does she run it, which sync?')
    expect(meta.action).toBe('Open')
  })

  test('a long entry is cut with an ellipsis', () => {
    expect(entrySnippet('word '.repeat(100), 40)).toMatch(/…$/)
    expect(entrySnippet('word '.repeat(100), 40).length).toBeLessThanOrEqual(40)
  })
})

test('how long a row has waited is drawn as days, then months', () => {
  expect(formatWaited('2026-10-01T08:00:00.000Z', NOW)).toBe('today')
  expect(formatWaited('2026-09-11T08:00:00.000Z', NOW)).toBe('20d')
  expect(formatWaited('2026-07-29T08:00:00.000Z', NOW)).toBe('2mo')
  expect(formatWaited('', NOW)).toBe('')
})

describe('arranging the card', () => {
  const rows = [
    row('c1', 'test', '2026-09-27T09:00:00.000Z'),
    row('d1', 'decide', '2026-09-29T09:00:00.000Z'),
    row('t1', 'answer', '2026-09-28T09:00:00.000Z'),
    row('c2', 'test', '2026-09-11T09:00:00.000Z'),
    row('h1', 'pickup', '2026-09-29T10:00:00.000Z'),
    row('c3', 'test', '')
  ]

  test('by kind: Answer, Test, Decide, Pick up, newest first inside each', () => {
    const arranged = arrangeWaiting(rows, 'kind')
    expect(arranged.shown.map((r) => r.key)).toEqual(['t1', 'c1', 'c2', 'c3', 'd1', 'h1'])
    expect(arranged.groups?.map((g) => [g.label, g.sub])).toEqual([
      ['Answer', '1 to answer'],
      ['Test', '3 to test'],
      ['Decide', '1 review'],
      ['Pick up', '1 handoff']
    ])
  })

  test('newest first: one list, the undated last', () => {
    const arranged = arrangeWaiting(rows, 'newest')
    expect(arranged.groups).toBeNull()
    expect(arranged.shown.map((r) => r.key)).toEqual(['h1', 'd1', 't1', 'c1', 'c2', 'c3'])
  })

  test('a long list stops at the limit and counts the rest', () => {
    const arranged = arrangeWaiting(rows, 'kind', 4)
    expect(arranged.shown).toHaveLength(4)
    expect(arranged.moreLabel).toBe('2 more waiting on you')
    // A group keeps its full count even when some of it is not drawn.
    expect(arranged.groups?.find((g) => g.kind === 'test')?.sub).toBe('3 to test')
    expect(arrangeWaiting(rows, 'kind').moreLabel).toBe('')
  })
})

describe('the remembered layout', () => {
  const store = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value)
    }
  }

  test('defaults to by kind, and remembers the other choice', () => {
    const storage = store()
    expect(readWaitingLayout(storage)).toBe(DEFAULT_WAITING_LAYOUT)
    writeWaitingLayout('newest', storage)
    expect(storage.data.get(WAITING_LAYOUT_STORAGE_KEY)).toBe('newest')
    expect(readWaitingLayout(storage)).toBe('newest')
  })

  test('the toggle reads Group and Sort', () => {
    expect(WAITING_LAYOUT_LABELS).toEqual({ kind: 'Group', newest: 'Sort' })
  })

  test('a remembered "oldest" becomes "newest"', () => {
    const storage = store()
    storage.data.set(WAITING_LAYOUT_STORAGE_KEY, 'oldest')
    expect(readWaitingLayout(storage)).toBe('newest')
    expect(storage.data.get(WAITING_LAYOUT_STORAGE_KEY)).toBe('newest')
  })

  test('a store that throws, or holds nonsense, falls back to the default', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(readWaitingLayout(broken)).toBe('kind')
    expect(() => writeWaitingLayout('newest', broken)).not.toThrow()
    const storage = store()
    storage.data.set(WAITING_LAYOUT_STORAGE_KEY, 'sideways')
    expect(readWaitingLayout(storage)).toBe('kind')
  })
})

function row(
  key: string,
  kind: WaitingMeta['kind'],
  at: string
): { key: string; at: string; wait: WaitingMeta } {
  return {
    key,
    at,
    wait: {
      kind,
      icon: 'check',
      tag: kind,
      lead: '',
      rest: '',
      snippet: '',
      progress: null,
      action: '',
      old: false
    }
  }
}

function testRun(options: {
  items?: string[]
  answered?: Record<string, string>
  mode?: 'test' | 'doc-review'
  body?: string
  decisions?: Array<{ id: string; question: string; choice: string }>
}): SerializableRun {
  const mode = options.mode ?? 'test'
  return {
    request: {
      id: 'r',
      title: 'A request',
      labels: {},
      mode,
      items: (options.items ?? []).map((id) => ({
        id,
        title: id,
        steps: [],
        expected: [],
        notes: []
      })),
      parked: [],
      degraded: false,
      raw: options.body ?? '',
      path: '/record/p/2026-09-27-a-request.md',
      ...(mode === 'doc-review'
        ? { document: { headings: [], bodyMarkdown: options.body ?? '' } }
        : {})
    },
    report:
      options.answered || options.decisions
        ? ({
            id: 'r',
            title: 'A request',
            startedAt: '2026-09-28T09:00:00.000Z',
            items:
              mode === 'doc-review'
                ? [{ id: 'document', decisions: options.decisions }]
                : Object.entries(options.answered ?? {}).map(([id, status]) => ({ id, status }))
          } as unknown as SerializableRun['report'])
        : null,
    status: 'waiting',
    project: 'p',
    round: null
  } as SerializableRun
}

function threadOf(bodies: string[]): Thread {
  const entries = bodies.map(
    (body, index) =>
      ({
        path: `/record/p/threads/${index}.md`,
        thread: 't',
        at: `2026-09-2${index}T09:00:00.000Z`,
        body
      }) as unknown as ThreadEntry
  )
  return {
    id: 't',
    title: 'T',
    projects: ['p'],
    parents: [],
    move: 'me',
    form: 'idea',
    state: 'open',
    entries,
    firstAt: entries[0].at,
    lastAt: entries[entries.length - 1].at,
    ageDays: 0,
    cold: false,
    dictated: false
  }
}
