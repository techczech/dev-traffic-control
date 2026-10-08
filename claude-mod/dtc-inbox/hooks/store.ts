/**
 * The one validator for every value this mod reads back from `$.store` (shared by every session,
 * so untrusted) and for its session-local filing record in `$.state`. Each reader takes `unknown`,
 * keeps the well-formed entries, drops the rest and never throws. Pure.
 */

import type { LocalFilings, Registry, RegistryEntry } from './inbox'
import type { SessionInfo, Sessions } from './presence'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Each own entry of `raw` that `pick` accepts; an empty record when `raw` is not an object. */
function recordOf<T>(raw: unknown, pick: (key: string, value: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {}
  if (!isObj(raw)) return out
  try {
    for (const [key, value] of Object.entries(raw)) {
      const kept = pick(key, value)
      if (kept !== null) out[key] = kept
    }
  } catch {
    // A hostile getter or proxy: keep what was gathered.
  }
  return out
}

/** Registry entries keyed by their own path, with string path, session, project and a finite filedAt. Any other field an entry carries is left out. */
export function readRegistry(raw: unknown): Registry {
  return recordOf<RegistryEntry>(raw, (key, v) => {
    if (!isObj(v) || !isStr(v.path) || v.path !== key || !isStr(v.sessionId) || !isStr(v.project) || !isNum(v.filedAt)) return null
    return { path: v.path, sessionId: v.sessionId, project: v.project, filedAt: v.filedAt, ...(isStr(v.label) ? { label: v.label } : {}) }
  })
}

/** Presence records with a string cwd and label and a finite lastSeen; a finite `expiresAt` is kept, any other dropped (the record then falls back to `lastSeen + OPEN_MS`). */
export function readSessions(raw: unknown): Sessions {
  return recordOf<SessionInfo>(raw, (_key, v) => {
    if (!isObj(v) || !isStr(v.cwd) || !isStr(v.label) || !isNum(v.lastSeen)) return null
    return { cwd: v.cwd, label: v.label, lastSeen: v.lastSeen, ...(isNum(v.expiresAt) ? { expiresAt: v.expiresAt } : {}) }
  })
}

/** This session's own filings (`$.state`), keyed by request path. */
export function readLocalFilings(raw: unknown): LocalFilings {
  return recordOf(raw, (_key, v) => {
    if (!isObj(v) || !isStr(v.project) || !isNum(v.filedAt)) return null
    return { project: v.project, filedAt: v.filedAt, ...(isNum(v.lastAt) ? { lastAt: v.lastAt } : {}) }
  })
}

/**
 * Release verdicts an agent already read through `dtc_answers` (shared `$.store`): release record
 * path → the stamp it read. Display only: a mark hides that set of verdicts from the band and the
 * pane, and never authorises anything.
 */
export type Seen = Record<string, string>

export function readSeen(raw: unknown): Seen {
  return recordOf<string>(raw, (_key, v) => (isStr(v) ? v : null))
}

/**
 * A stored value that is there and cannot be relied on: the store failed to read it, or it is not
 * the shape this mod writes. Never the same thing as a value that is absent.
 */
export class Unreadable extends Error {
  constructor(what: string) {
    super(`${what} could not be read`)
    this.name = 'Unreadable'
  }
}

/** For a read–modify–write: the plain reader, refusing a stored value that is there and is not an object at all (rewriting it would lose whatever it was). Entries that are not well formed are dropped. */
export function heldAs<T>(what: string, raw: unknown, read: (raw: unknown) => T): T {
  if (raw !== undefined && !isObj(raw)) throw new Unreadable(what)
  return read(raw)
}
