/** The "From this session" section: this session's filings, each with where it stands. Read-only; I/O is injected. */

import { classifyRecordPath, requestPathOf } from './paths'
import type { Registry } from './inbox'
import { MAX_REQUEST_BYTES, requestTitle } from './reports'
import { cleanLine } from './sanitise'
import type { ScanEntry } from './scan'
import { readRegistry } from './store'

export type SessionState = 'not-opened' | 'opened' | 'answered-waiting' | 'collected' | 'unreadable'

export const SESSION_LABEL: Record<SessionState, string> = {
  'not-opened': 'not opened yet',
  opened: 'opened, not finished',
  'answered-waiting': 'answer waiting — ask the agent to collect it',
  collected: 'collected',
  unreadable: 'could not read',
}

/** One filing of this session: the record (a stub when the scan does not list it), its state and when it was filed. */
export type SessionFiling = { entry: ScanEntry; state: SessionState; filedAt: number }

/** This session is waiting on the reviewer while the request is unopened or unfinished. */
export const isWaitingOnReviewer = (s: SessionState): boolean => s === 'not-opened' || s === 'opened'

/** Answered and not yet collected. */
export const isAnswered = (s: SessionState): boolean => s === 'answered-waiting'

/** State from the record's state. An answer file that could not be read is `unreadable`. */
export function sessionStateOf(e: ScanEntry): SessionState | null {
  switch (e.state) {
    case 'none':
      return 'not-opened'
    case 'opened':
    case 'in-progress':
      return 'opened'
    case 'waiting':
      return 'answered-waiting'
    case 'collected':
      return 'collected'
    case 'malformed':
      return 'unreadable'
    default:
      return null
  }
}

export type SessionProbe = {
  exists: (path: string) => Promise<boolean>
  read: (path: string, maxBytes?: number) => Promise<string | null>
}

const ZERO = { pass: 0, partial: 0, fail: 0, skip: 0, unanswered: 0 }

/**
 * Registry entries filed by `sessionId`, newest filed first. A request the scan lists uses the scan's entry; one it
 * skips (unopened, collected) is probed with `probe`. A request whose file is gone, or whose report is malformed, is left out.
 */
export async function sessionFilings(args: {
  registry: Registry
  sessionId: string
  entries: readonly ScanEntry[]
  root: string
  probe: SessionProbe
}): Promise<SessionFiling[]> {
  const byPath = new Map(args.entries.map(e => [requestPathOf(args.root, e), e] as const))
  const out: SessionFiling[] = []
  // A shared-store value: validated here too, so a malformed entry is dropped, never dereferenced.
  for (const filing of Object.values(readRegistry(args.registry))) {
    if (filing.sessionId !== args.sessionId) continue
    const classified = classifyRecordPath(filing.path, args.root)
    if (classified === null) continue
    const ref = classified.ref
    const scanned = byPath.get(filing.path)
    let entry: ScanEntry | undefined = scanned
    // An idea or a release record with no answer waiting is not a pending request: left out.
    if (entry === undefined && classified.kind !== 'request') continue
    if (entry === undefined) {
      const base = filing.path.replace(/\.md$/, '')
      let state: ScanEntry['state'] | null = null
      if ((await args.probe.exists(`${base}.collected.json`)) || (await args.probe.exists(`${base}.resolved.md`))) state = 'collected'
      else if (!(await args.probe.exists(`${base}.report.json`)) && !(await args.probe.exists(`${base}.opened.json`)) && (await args.probe.exists(filing.path))) state = 'none'
      if (state === null) continue
      const md = await args.probe.read(filing.path, MAX_REQUEST_BYTES)
      const found = md === null ? '' : cleanLine(requestTitle(md))
      entry = {
        project: ref.project,
        rel: ref.rel,
        state,
        title: '',
        completedAt: null,
        counts: ZERO,
        decisions: { answered: 0, total: 0 },
        ...(found !== '' ? { requestTitle: found } : {}),
      }
    }
    const state = sessionStateOf(entry)
    if (state !== null) out.push({ entry, state, filedAt: filing.filedAt })
  }
  return out.sort((a, b) => b.filedAt - a.filedAt || (a.entry.rel < b.entry.rel ? -1 : 1))
}

/** Waiting entries in the order `/dtc collect n` counts them: this session's answered ones first, then the rest. */
export function collectOrder(waiting: readonly ScanEntry[], filings: readonly SessionFiling[], root: string): ScanEntry[] {
  const mine = filings.filter(f => isAnswered(f.state)).map(f => f.entry)
  const taken = new Set(filings.map(f => requestPathOf(root, f.entry)))
  return [...mine, ...waiting.filter(e => !taken.has(requestPathOf(root, e)))]
}
