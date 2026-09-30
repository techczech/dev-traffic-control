import { describe, expect, test } from 'vitest'
import type { QaReport, QaRequest } from '../../../../main/qa/types'
import type { QaSnapshot, ReadingProgressState, SerializableRun } from '../../../../shared/ipc'
import { filterSpecRows, needsSpecCount, specQuestions, specRows } from '../specs'
import { ALL_PROJECTS } from '../../../../shared/windowScope'

function request(
  path: string,
  options: { mode?: QaRequest['mode']; body?: string; title?: string; app?: string } = {}
): QaRequest {
  const body = options.body ?? '## First\n\nText.\n\n## Second\n\nMore.'
  return {
    id: path,
    title: options.title ?? 'A specification',
    app: options.app,
    labels: {},
    mode: options.mode ?? 'doc-review',
    items: [],
    parked: [],
    degraded: false,
    document:
      (options.mode ?? 'doc-review') === 'doc-review'
        ? {
            bodyMarkdown: body,
            headings: [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => ({
              id: match[1].toLowerCase().replaceAll(' ', '-'),
              title: match[1],
              level: 2 as const
            }))
          }
        : undefined,
    raw: body,
    path
  }
}

function report(
  options: {
    finished?: boolean
    commented?: boolean
    decisions?: NonNullable<QaReport['items'][number]['decisions']>
  } = {}
): QaReport {
  return {
    id: 'review',
    title: 'Review',
    startedAt: '2026-08-06T10:00:00.000Z',
    ...(options.finished ? { completedAt: '2026-08-06T11:00:00.000Z' } : {}),
    noteFiles: [],
    items: [
      {
        id: 'document',
        title: 'Document',
        status: options.finished ? 'partial' : 'unanswered',
        comment: '',
        flagged: [],
        quotes: options.commented
          ? [{ text: 'Quoted line', comment: 'Please clarify.', section: 'first', number: 1 }]
          : [],
        decisions: options.decisions,
        screenshots: []
      }
    ]
  }
}

function run(
  project: string,
  options: {
    request?: QaRequest
    report?: QaReport | null
    requestMtime?: string
  } = {}
): SerializableRun {
  return {
    request:
      options.request ?? request(`/record/${project}/review.md`, { app: project, title: project }),
    report: options.report ?? null,
    status: options.report?.completedAt ? 'done' : options.report ? 'in-progress' : 'waiting',
    project,
    round: null,
    requestMtime: options.requestMtime ?? '2026-08-06T09:00:00.000Z'
  }
}

function snapshot(runs: SerializableRun[]): QaSnapshot {
  return {
    root: '/record',
    rootMissing: false,
    runs,
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: [],
    scannedAt: '2026-08-07T01:00:00.000Z'
  }
}

describe('specRows', () => {
  test('selects every document review across projects and never a test run', () => {
    const rows = specRows(
      snapshot([
        run('redforge'),
        run('wordforge'),
        run('test-app', {
          request: request('/record/test-app/test.md', { mode: 'test' })
        })
      ]),
      ALL_PROJECTS,
      {}
    )

    expect(rows.map((row) => row.app)).toEqual(['redforge', 'wordforge'])
  })

  test('derives Answered, In conversation, Being written and openability', () => {
    const rows = specRows(
      snapshot([
        run('answered', { report: report({ finished: true, commented: true }) }),
        run('conversation', { report: report({ commented: true }) }),
        run('writing', {
          request: request('/record/writing/review.md', { body: '   ', app: 'Writing' })
        }),
        run('needs')
      ]),
      ALL_PROJECTS,
      {}
    )

    expect(Object.fromEntries(rows.map((row) => [row.app, row.state]))).toEqual({
      needs: 'Needs your comment',
      conversation: 'In conversation',
      Writing: 'Being written',
      answered: 'Answered'
    })
    expect(rows.find((row) => row.app === 'Writing')?.openable).toBe(false)
    expect(rows.find((row) => row.app === 'needs')?.openable).toBe(true)
    expect(needsSpecCount(rows)).toBe(1)
  })

  test('orders what needs him first, then conversation, writing and answered', () => {
    const rows = specRows(
      snapshot([
        run('answered', { report: report({ finished: true }) }),
        run('writing', {
          request: request('/record/writing/review.md', { body: '', app: 'Writing' })
        }),
        run('conversation', { report: report({ commented: true }) }),
        run('needs')
      ]),
      ALL_PROJECTS,
      {}
    )

    expect(rows.map((row) => row.state)).toEqual([
      'Needs your comment',
      'In conversation',
      'Being written',
      'Answered'
    ])
  })

  test('uses the saved slug when present and degrades changed documents to best effort', () => {
    const spec = run('redforge', {
      request: request('/record/redforge/review.md', {
        body: '## New first\n\nA.\n\n## New second\n\nB.\n\n## New third\n\nC.'
      })
    })
    const progress: ReadingProgressState = {
      'redforge/review.md': {
        sectionSlug: 'removed-section',
        sectionIndex: 1,
        sectionCount: 4,
        updatedAt: '2026-08-06T12:00:00.000Z'
      }
    }

    expect(specRows(snapshot([spec]), ALL_PROJECTS, progress)[0].progress).toMatchObject({
      phrase: 'Read to “New second”',
      sectionSlug: 'new-second'
    })

    progress['redforge/review.md'] = {
      ...progress['redforge/review.md'],
      sectionIndex: 7
    }
    expect(specRows(snapshot([spec]), ALL_PROJECTS, progress)[0].progress.phrase).toBe(
      'Read through'
    )
  })

  test('filters by Open, Answered and All plus app or title text', () => {
    const rows = specRows(
      snapshot([
        run('RedForge', { request: request('/record/RedForge/a.md', { title: 'Audiobook PRD' }) }),
        run('WordForge', {
          request: request('/record/WordForge/b.md', { title: 'HTML export' }),
          report: report({ finished: true })
        })
      ]),
      ALL_PROJECTS,
      {}
    )

    expect(filterSpecRows(rows, 'open', '')).toHaveLength(1)
    expect(filterSpecRows(rows, 'answered', '')).toHaveLength(1)
    expect(filterSpecRows(rows, 'all', 'word')).toHaveLength(1)
    expect(filterSpecRows(rows, 'all', 'audiobook')).toHaveLength(1)
  })
})

describe('specQuestions', () => {
  const playbackDecision = `## Playback {#playback}

Continuous play keeps an audiobook moving without another gesture.

\`\`\`decision {#auto-next}
Should the next chapter start automatically?
- Yes, always
- No, wait for me
\`\`\``

  test('aggregates decisions with their document, heading and pinned id', () => {
    const questions = specQuestions(
      snapshot([
        run('redforge', {
          request: request('/record/redforge/playback.md', {
            app: 'RedForge',
            title: 'Audiobook management',
            body: playbackDecision
          })
        }),
        run('wordforge', {
          request: request('/record/wordforge/export.md', {
            app: 'WordForge',
            title: 'HTML export',
            body: `## Notes

\`\`\`decision {#carry-notes}
Should notes travel with an export?
- Include notes
- Strip notes
\`\`\``
          })
        })
      ]),
      ALL_PROJECTS
    )

    expect(questions).toHaveLength(2)
    expect(questions[0]).toMatchObject({
      requestPath: '/record/redforge/playback.md',
      requestKey: 'redforge/playback.md',
      app: 'RedForge',
      documentTitle: 'Audiobook management',
      headingId: 'playback',
      headingTitle: 'Playback',
      id: 'auto-next',
      question: 'Should the next chapter start automatically?',
      options: ['Yes, always', 'No, wait for me'],
      choice: ''
    })
  })

  test('keeps a pinned id across a re-read and retains an answered decision collapsed', () => {
    const answered = report({
      decisions: [
        {
          id: 'auto-next',
          question: 'Should the next chapter start automatically?',
          choice: 'No, wait for me'
        }
      ]
    })
    const first = specQuestions(
      snapshot([
        run('redforge', {
          request: request('/record/redforge/playback.md', { body: playbackDecision }),
          report: answered
        })
      ]),
      ALL_PROJECTS
    )
    const reread = specQuestions(
      snapshot([
        run('redforge', {
          request: request('/record/redforge/playback.md', {
            body: `## New preface

More context.

${playbackDecision}`
          }),
          report: answered
        })
      ]),
      ALL_PROJECTS
    )

    expect(first[0]).toMatchObject({ id: 'auto-next', choice: 'No, wait for me', answered: true })
    expect(reread[0]).toMatchObject({ id: 'auto-next', choice: 'No, wait for me', answered: true })
  })

  test('a document without decision blocks contributes nothing and does not error', () => {
    expect(
      specQuestions(
        snapshot([
          run('redforge', {
            request: request('/record/redforge/no-decisions.md', {
              body: '## Settled\n\nThere is nothing to choose.'
            })
          })
        ]),
        ALL_PROJECTS
      )
    ).toEqual([])
  })
})

// Ticket 13: Specs never read the window scope either. A document is filed
// under its record-repo project, which is what a scope names — note that a
// row's `app` is the request's own label and may differ from the project.
describe('the window scope decides which documents Specs shows', () => {
  const REDFORGE = { kind: 'project', slug: 'redforge' } as const

  test('All projects keeps every document, a project scope keeps only its own', () => {
    const fleet = snapshot([run('redforge'), run('wordforge')])

    expect(specRows(fleet, ALL_PROJECTS, {}).map((row) => row.app)).toEqual([
      'redforge',
      'wordforge'
    ])
    expect(specRows(fleet, REDFORGE, {}).map((row) => row.app)).toEqual(['redforge'])
  })

  test('the questions list is scoped with the documents it belongs to', () => {
    const decision = `## Playback {#playback}

\`\`\`decision {#auto-next}
Should the next chapter start automatically?
- Yes, always
- No, wait for me
\`\`\``
    const fleet = snapshot([
      run('redforge', {
        request: request('/record/redforge/playback.md', { body: decision })
      }),
      run('wordforge', {
        request: request('/record/wordforge/export.md', { body: decision })
      })
    ])

    expect(specQuestions(fleet, ALL_PROJECTS).map((q) => q.requestPath)).toEqual([
      '/record/redforge/playback.md',
      '/record/wordforge/export.md'
    ])
    expect(specQuestions(fleet, REDFORGE).map((q) => q.requestPath)).toEqual([
      '/record/redforge/playback.md'
    ])
  })
})
