import type { Form, Move, Thread, ThreadEntry } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const COLD_DAYS = 7

/**
 * Derive threads from their entries: group by `thread`, then
 * every scalar field is the value from the LATEST entry that asserts it (key
 * present), falling back to a documented default when no entry asserts it.
 * Nothing is stored mutably. `now` is the scan time, so age moves with the scan.
 */
export function deriveThreads(entries: ThreadEntry[], now: string): Thread[] {
  const byThread = new Map<string, ThreadEntry[]>()
  for (const e of entries) {
    const list = byThread.get(e.thread)
    if (list) list.push(e)
    else byThread.set(e.thread, [e])
  }

  const nowMs = Date.parse(now)
  const threads: Thread[] = []
  for (const [id, list] of byThread) {
    const sorted = [...list].sort((a, b) =>
      a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.path < b.path ? -1 : 1
    )

    const projects = unionInOrder(sorted, (e) => e.projects)
    const parents = unionInOrder(sorted, (e) => e.parents)
    const move = (latest(sorted, (e) => e.move) as Move | undefined) ?? 'nobody'
    const form = (latest(sorted, (e) => e.form) as Form | undefined) ?? 'idea'
    const state = latest(sorted, (e) => e.state) ?? 'open'
    const outcome = latest(sorted, (e) => e.outcome)
    const title = latest(sorted, (e) => e.title) ?? firstBodyLine(sorted) ?? id

    const lastAt = sorted[sorted.length - 1].at
    const lastMs = Date.parse(lastAt)
    const ageDays =
      Number.isNaN(lastMs) || Number.isNaN(nowMs) ? 0 : Math.max(0, (nowMs - lastMs) / DAY_MS)

    threads.push({
      id,
      title,
      projects,
      parents,
      move,
      form,
      state,
      outcome,
      entries: sorted,
      firstAt: sorted[0].at,
      lastAt,
      ageDays,
      cold: ageDays >= COLD_DAYS,
      dictated: sorted.some((e) => e.dictation)
    })
  }
  return threads
}

/**
 * Derived rank for a project: the index of each thread in the LATEST `order`
 * entry that names that project. Threads absent from it (or with no order
 * entry at all) rank after, by `lastAt` descending. Returns id → rank (0-based).
 */
export function rankFor(
  project: string,
  threads: Thread[],
  entries: ThreadEntry[]
): Map<string, number> {
  const orders = entries
    .filter((e) => e.order && e.order.project === project)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.path < b.path ? -1 : 1))
  const latestOrder = orders.length ? orders[orders.length - 1].order!.threads : []

  const inProject = threads.filter((t) => t.projects.includes(project))
  const rank = new Map<string, number>()
  latestOrder.forEach((id, i) => {
    if (inProject.some((t) => t.id === id)) rank.set(id, i)
  })

  const rest = inProject
    .filter((t) => !rank.has(t.id))
    .sort((a, b) => (a.lastAt > b.lastAt ? -1 : a.lastAt < b.lastAt ? 1 : 0))
  let next = latestOrder.length
  for (const t of rest) rank.set(t.id, next++)
  return rank
}

/** The value from the latest entry whose selector returns a non-undefined value. */
function latest<T>(sorted: ThreadEntry[], pick: (e: ThreadEntry) => T | undefined): T | undefined {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const v = pick(sorted[i])
    if (v !== undefined) return v
  }
  return undefined
}

/** Union of a list-valued field across entries, in order of first assertion. */
function unionInOrder(sorted: ThreadEntry[], pick: (e: ThreadEntry) => string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of sorted) {
    for (const v of pick(e)) {
      if (!seen.has(v)) {
        seen.add(v)
        out.push(v)
      }
    }
  }
  return out
}

/** First non-empty body line of the earliest entry, trimmed to 120 chars. */
function firstBodyLine(sorted: ThreadEntry[]): string | undefined {
  for (const e of sorted) {
    for (const line of e.body.split(/\r?\n/)) {
      const t = line.trim()
      if (t) return t.length > 120 ? t.slice(0, 120) : t
    }
  }
  return undefined
}
