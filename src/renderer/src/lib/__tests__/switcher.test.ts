import { describe, expect, test } from 'vitest'
import { switcherEntries, filterEntries } from '../switcher'
import type { SerializableRun, QaSnapshot } from '../../../../shared/ipc'
import type { NoteRef } from '../../../../main/qa/scan'
import type { RunStatus } from '../../../../main/qa/types'

function run(
  project: string,
  path: string,
  title: string,
  status: RunStatus = 'waiting'
): SerializableRun {
  return {
    request: {
      id: title,
      title,
      labels: {},
      mode: 'test',
      items: [],
      parked: [],
      degraded: false,
      raw: '',
      path
    },
    report: null,
    status,
    project,
    round: null
  }
}

function note(project: string, path: string, title: string): NoteRef {
  return { path, title, status: 'draft', project, round: null }
}

function snapshot(opts: Partial<QaSnapshot>): QaSnapshot {
  return {
    root: '/qa',
    rootMissing: false,
    runs: opts.runs ?? [],
    notes: opts.notes ?? [],
    entries: opts.entries ?? [],
    threads: opts.threads ?? [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: opts.projects ?? [],
    scannedAt: ''
  }
}

describe('switcherEntries', () => {
  test('leads with All projects, then projects, then runs, then notes', () => {
    const s = snapshot({
      projects: ['tallyboard', 'pebbles'],
      runs: [run('tallyboard', '/qa/tallyboard/2026-07-18-a.md', 'A')],
      notes: [note('tallyboard', '/qa/tallyboard/2026-07-18-note-x.md', 'X')]
    })
    const kinds = switcherEntries(s).map((e) => e.kind)
    expect(kinds).toEqual(['all', 'project', 'project', 'run', 'note'])
  })

  test('non-done runs precede done runs; done runs cap at 10 newest first', () => {
    const runs: SerializableRun[] = []
    for (let i = 0; i < 12; i++) {
      const day = String(i + 1).padStart(2, '0')
      runs.push(run('p', `/qa/p/2026-07-${day}-done.md`, `done-${day}`, 'done'))
    }
    runs.push(run('p', '/qa/p/2026-07-01-live.md', 'live', 'in-progress'))
    const entries = switcherEntries(snapshot({ runs }))
    const runEntries = entries.filter((e) => e.kind === 'run')
    // 1 non-done + 10 done (2 oldest done dropped) = 11
    expect(runEntries).toHaveLength(11)
    expect(runEntries[0].kind === 'run' && runEntries[0].run.status).toBe('in-progress')
    // first done is the newest (day 12)
    const firstDone = runEntries[1]
    expect(firstDone.kind === 'run' && firstDone.run.request.title).toBe('done-12')
  })

  test('notes are newest first and capped at 10', () => {
    const notes: NoteRef[] = []
    for (let i = 0; i < 12; i++) {
      const day = String(i + 1).padStart(2, '0')
      notes.push(note('p', `/qa/p/2026-07-${day}-note-n.md`, `n-${day}`))
    }
    const noteEntries = switcherEntries(snapshot({ notes })).filter((e) => e.kind === 'note')
    expect(noteEntries).toHaveLength(10)
    expect(noteEntries[0].kind === 'note' && noteEntries[0].note.title).toBe('n-12')
  })
})

describe('filterEntries', () => {
  const s = snapshot({
    projects: ['tallyboard'],
    runs: [run('tallyboard', '/qa/tallyboard/2026-07-18-padding.md', 'Title padding')],
    notes: [note('pebbles', '/qa/pebbles/2026-07-18-note-muddy.md', 'Sidebar muddy')]
  })
  const entries = switcherEntries(s)

  test('empty query returns everything in stable order', () => {
    expect(filterEntries(entries, '')).toEqual(entries)
  })

  test('matches on title, case-insensitive', () => {
    const hits = filterEntries(entries, 'PADDING')
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('run')
  })

  test('matches on filename', () => {
    const hits = filterEntries(entries, 'muddy')
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('note')
  })

  test('matches a project slug', () => {
    const hits = filterEntries(entries, 'tallyboard')
    // project slug + the run under that project both match
    expect(hits.some((e) => e.kind === 'project')).toBe(true)
  })
})
