import { describe, expect, test } from 'vitest'
import { projectRounds, roundRollupLine } from '../project'
import type { SerializableRun, QaSnapshot } from '../../../../shared/ipc'
import type { NoteRef } from '../../../../main/qa/scan'
import type { ItemStatus, QaReport, RunStatus } from '../../../../main/qa/types'

function report(statuses: ItemStatus[], done: boolean): QaReport {
  return {
    id: 'r',
    title: 'r',
    startedAt: '',
    completedAt: done ? '2026-07-18T00:00:00.000Z' : undefined,
    noteFiles: [],
    items: statuses.map((s, i) => ({
      id: `i${i}`,
      title: `i${i}`,
      status: s,
      comment: '',
      flagged: [],
      quotes: [],
      screenshots: []
    }))
  }
}

function run(
  round: string | null,
  path: string,
  opts: { status?: RunStatus; gate?: string; report?: QaReport } = {}
): SerializableRun {
  return {
    request: {
      id: path,
      title: path,
      labels: opts.gate ? { gate: opts.gate } : {},
      mode: 'test',
      items: [],
      parked: [],
      degraded: false,
      raw: '',
      path
    },
    report: opts.report ?? null,
    status: opts.status ?? 'waiting',
    project: 'tallyboard',
    round
  }
}

function note(round: string | null, path: string): NoteRef {
  return { path, title: path, status: 'draft', project: 'tallyboard', round }
}

function snapshot(runs: SerializableRun[], notes: NoteRef[] = []): QaSnapshot {
  return {
    root: '/qa',
    rootMissing: false,
    runs,
    notes,
    entries: [],
    threads: [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: ['tallyboard'],
    scannedAt: ''
  }
}

describe('projectRounds', () => {
  test('groups by round with the root-level (null) group first', () => {
    const s = snapshot([
      run('0.18-title', '/qa/tallyboard/0.18-title/2026-07-18-a.md'),
      run(null, '/qa/tallyboard/2026-07-17-loose.md')
    ])
    const rounds = projectRounds(s, 'tallyboard')
    expect(rounds.map((r) => r.round)).toEqual([null, '0.18-title'])
  })

  test('named rounds are newest first by best content date', () => {
    const s = snapshot([
      run('0.17-pathways', '/qa/tallyboard/0.17-pathways/2026-07-11-x.md'),
      run('0.18-title', '/qa/tallyboard/0.18-title/2026-07-18-y.md')
    ])
    expect(projectRounds(s, 'tallyboard').map((r) => r.round)).toEqual([
      '0.18-title',
      '0.17-pathways'
    ])
  })

  test('runs within a round are newest first', () => {
    const s = snapshot([
      run('r', '/qa/tallyboard/r/2026-07-16-old.md'),
      run('r', '/qa/tallyboard/r/2026-07-18-new.md')
    ])
    const [round] = projectRounds(s, 'tallyboard')
    expect(round.runs.map((r) => r.request.path)).toEqual([
      '/qa/tallyboard/r/2026-07-18-new.md',
      '/qa/tallyboard/r/2026-07-16-old.md'
    ])
  })

  test('gate rollup: passed true when the latest stamped report has no fail/unanswered', () => {
    const s = snapshot([
      run('r', '/qa/tallyboard/r/2026-07-18-g4.md', {
        status: 'done',
        gate: '4',
        report: report(['pass', 'partial', 'skip'], true)
      })
    ])
    expect(projectRounds(s, 'tallyboard')[0].rollup.gates).toEqual([{ label: '4', passed: true }])
  })

  test('gate rollup: passed false when the latest stamped report has a fail', () => {
    const s = snapshot([
      run('r', '/qa/tallyboard/r/2026-07-18-g4.md', {
        status: 'done',
        gate: '4',
        report: report(['pass', 'fail'], true)
      })
    ])
    expect(projectRounds(s, 'tallyboard')[0].rollup.gates).toEqual([{ label: '4', passed: false }])
  })

  test('gate rollup: passed false when the latest stamped report has an unanswered item', () => {
    const s = snapshot([
      run('r', '/qa/tallyboard/r/2026-07-18-g4.md', {
        status: 'done',
        gate: '4',
        report: report(['pass', 'unanswered'], true)
      })
    ])
    expect(projectRounds(s, 'tallyboard')[0].rollup.gates).toEqual([{ label: '4', passed: false }])
  })

  test('gate rollup: null while nothing carrying the label is stamped', () => {
    const s = snapshot([
      run('r', '/qa/tallyboard/r/2026-07-18-g5.md', { status: 'in-progress', gate: '5' })
    ])
    expect(projectRounds(s, 'tallyboard')[0].rollup.gates).toEqual([{ label: '5', passed: null }])
  })

  test('gate rollup: uses the newest stamped run when several carry the label', () => {
    const s = snapshot([
      run('r', '/qa/tallyboard/r/2026-07-16-g4-old.md', {
        status: 'done',
        gate: '4',
        report: report(['fail'], true)
      }),
      run('r', '/qa/tallyboard/r/2026-07-18-g4-new.md', {
        status: 'done',
        gate: '4',
        report: report(['pass'], true)
      })
    ])
    expect(projectRounds(s, 'tallyboard')[0].rollup.gates).toEqual([{ label: '4', passed: true }])
  })

  test('rollup counts runs, done and notes', () => {
    const s = snapshot(
      [
        run('r', '/qa/tallyboard/r/2026-07-18-a.md', {
          status: 'done',
          report: report(['pass'], true)
        }),
        run('r', '/qa/tallyboard/r/2026-07-17-b.md', { status: 'in-progress' })
      ],
      [note('r', '/qa/tallyboard/r/2026-07-18-note-x.md')]
    )
    const { rollup } = projectRounds(s, 'tallyboard')[0]
    expect(rollup.runs).toBe(2)
    expect(rollup.done).toBe(1)
    expect(rollup.notes).toBe(1)
  })
})

describe('roundRollupLine', () => {
  test('counts runs and notes, and states every gate', () => {
    expect(
      roundRollupLine({
        runs: 3,
        done: 2,
        gates: [
          { label: '4', passed: true },
          { label: '5', passed: false },
          { label: '6', passed: null }
        ],
        notes: 1
      })
    ).toBe('3 runs · Gate 4 passed · Gate 5 failed · Gate 6 in progress · 1 note')
  })

  test('singular and none read as words', () => {
    expect(roundRollupLine({ runs: 1, done: 0, gates: [], notes: 0 })).toBe('1 run · no notes')
    expect(roundRollupLine({ runs: 0, done: 0, gates: [], notes: 2 })).toBe('0 runs · 2 notes')
  })
})

describe('a round\u2019s latest date', () => {
  test('is the newest of its runs and notes, and blank when nothing is dated', () => {
    const s = snapshot(
      [run('r', '/qa/tallyboard/r/2026-07-16-a.md'), run('undated', '/qa/tallyboard/undated/x.md')],
      [note('r', '/qa/tallyboard/r/2026-07-19-note.md')]
    )
    const rounds = projectRounds(s, 'tallyboard')
    expect(rounds.find((round) => round.round === 'r')?.latest).toBe('2026-07-19')
    expect(rounds.find((round) => round.round === 'undated')?.latest).toBe('')
  })
})
