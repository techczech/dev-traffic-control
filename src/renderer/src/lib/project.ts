import type { NoteRef } from '../../../main/qa/scan'
import type { SerializableRun, QaSnapshot } from '../../../shared/ipc'

export interface GateRollup {
  label: string
  passed: boolean | null // null while nothing carrying this label is stamped
}
export interface RoundRollup {
  runs: number
  done: number
  gates: GateRollup[]
  notes: number
}
export interface ProjectRound {
  round: string | null // null == root-level artefacts (no round subfolder)
  runs: SerializableRun[] // newest first
  notes: NoteRef[] // newest first
  rollup: RoundRollup
  /** The newest content date in the round (`YYYY-MM-DD`), `''` when none is dated. */
  latest: string
}

/** Leading `YYYY-MM-DD` of a filename, or `''` when absent. */
function filenameDate(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? ''
  const m = base.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}
function runDate(run: SerializableRun): string {
  return run.request.date ?? filenameDate(run.request.path)
}
/** Newest first: date desc, then key desc as a stable tie-break. */
function byDateDesc(aDate: string, aKey: string, bDate: string, bKey: string): number {
  if (aDate !== bDate) return aDate < bDate ? 1 : -1
  return aKey < bKey ? 1 : -1
}

/**
 * A gate rollup per distinct `gate` label in a round: passed = the latest
 * STAMPED report carrying that label has no `fail` and no `unanswered` item;
 * null while nothing carrying it is stamped (the gate is still in progress).
 */
function gateRollups(runs: SerializableRun[]): GateRollup[] {
  const labels: string[] = []
  for (const r of runs) {
    const g = r.request.labels.gate
    if (g && !labels.includes(g)) labels.push(g)
  }
  return labels.map((label) => {
    const stamped = runs
      .filter(
        (r) => r.request.labels.gate === label && r.status === 'done' && r.report?.completedAt
      )
      .sort((a, b) => byDateDesc(runDate(a), a.request.path, runDate(b), b.request.path))
    const latest = stamped[0]
    if (!latest?.report) return { label, passed: null }
    const items = latest.report.items.filter((i) => !i.removed)
    const passed = items.every((i) => i.status !== 'fail' && i.status !== 'unanswered')
    return { label, passed }
  })
}

/**
 * A project's rounds: root-level artefacts (round null) first, then named
 * rounds newest-first by their best content date. Runs and notes within each
 * round are newest first; the rollup summarises runs, done count, gate status
 * and note count.
 */
export function projectRounds(s: QaSnapshot, slug: string): ProjectRound[] {
  const runs = s.runs.filter((r) => r.project === slug)
  const notes = s.notes.filter((n) => n.project === slug)

  const map = new Map<string | null, { runs: SerializableRun[]; notes: NoteRef[] }>()
  const ensure = (round: string | null): { runs: SerializableRun[]; notes: NoteRef[] } => {
    let g = map.get(round)
    if (!g) {
      g = { runs: [], notes: [] }
      map.set(round, g)
    }
    return g
  }
  for (const r of runs) ensure(r.round).runs.push(r)
  for (const n of notes) ensure(n.round).notes.push(n)

  const rounds: ProjectRound[] = []
  for (const [round, g] of map) {
    g.runs.sort((a, b) => byDateDesc(runDate(a), a.request.path, runDate(b), b.request.path))
    g.notes.sort((a, b) => byDateDesc(filenameDate(a.path), a.path, filenameDate(b.path), b.path))
    rounds.push({
      round,
      runs: g.runs,
      notes: g.notes,
      rollup: {
        runs: g.runs.length,
        done: g.runs.filter((r) => r.status === 'done').length,
        gates: gateRollups(g.runs),
        notes: g.notes.length
      },
      latest: newestDate([...g.runs.map(runDate), ...g.notes.map((n) => filenameDate(n.path))])
    })
  }

  rounds.sort((a, b) => {
    if (a.round === null) return -1
    if (b.round === null) return 1
    const da = a.latest
    const db = b.latest
    if (da !== db) return da < db ? 1 : -1
    return a.round < b.round ? 1 : -1
  })
  return rounds
}

function newestDate(dates: readonly string[]): string {
  const dated = dates.filter(Boolean)
  return dated.length ? dated.reduce((a, b) => (a >= b ? a : b)) : ''
}

/**
 * A round's rollup in words: `3 runs · Gate beta passed · 1 note`.
 */
export function roundRollupLine(rollup: RoundRollup): string {
  const parts: string[] = [`${rollup.runs} run${rollup.runs === 1 ? '' : 's'}`]
  for (const gate of rollup.gates) {
    const state = gate.passed === null ? 'in progress' : gate.passed ? 'passed' : 'failed'
    parts.push(`Gate ${gate.label} ${state}`)
  }
  parts.push(
    rollup.notes === 0 ? 'no notes' : `${rollup.notes} note${rollup.notes === 1 ? '' : 's'}`
  )
  return parts.join(' · ')
}
