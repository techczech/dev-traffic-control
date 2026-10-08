/** Which sessions are open, and what each request's origin and waiting status is. Pure. */

import { requestPathOf } from './paths'
import type { Registry } from './inbox'
import type { ScanEntry } from './scan'
import { formatWhen } from './when'
import type { Tz } from './when'

/** The shortest open window, and the fallback for a record written without `expiresAt`. Heartbeats come with every band refresh; session end removes the entry at once. */
export const OPEN_MS = 90_000
export const PRUNE_MS = 14 * 86_400_000
export const WATCH_LIVE_MS = 90_000
const LABEL_PROMPT = 60

/**
 * A session's presence record. `expiresAt` is written by the session itself from its own band-refresh
 * interval (`lastSeen + openMsOf(own bandMs)`), so every observer reads the same open window whatever
 * its own configuration. Records written before it existed fall back to `lastSeen + OPEN_MS`.
 */
export type SessionInfo = { cwd: string; label: string; lastSeen: number; expiresAt?: number }
export type Sessions = Record<string, SessionInfo>

/** `<repo folder> · <first prompt cut to 60 characters>`; the folder alone when there is no prompt yet. */
export function deriveLabel(project: string, firstPrompt: string | null): string {
  const text = (firstPrompt ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return project
  return `${project} · ${text.length > LABEL_PROMPT ? `${text.slice(0, LABEL_PROMPT - 1).trimEnd()}…` : text}`
}

/**
 * Refreshes one session's entry, with its own expiry `now + openMs` (`openMs` = `openMsOf(own bandMs)`),
 * and drops every entry not seen for 14 days.
 */
export function touchSession(sessions: Sessions, id: string, info: { cwd: string; label: string }, now: number, openMs: number): Sessions {
  const next: Sessions = {}
  for (const [key, s] of Object.entries(sessions)) if (key !== id && now - s.lastSeen <= PRUNE_MS) next[key] = s
  next[id] = { cwd: info.cwd, label: info.label, lastSeen: now, expiresAt: now + openMs }
  return next
}

/** Removes one session's presence entry (its session ended). */
export function forgetSession(sessions: Sessions, id: string): Sessions {
  const next: Sessions = {}
  for (const [key, s] of Object.entries(sessions)) if (key !== id) next[key] = s
  return next
}

/** The open window for a band-refresh (heartbeat) interval: two missed heartbeats, never under 90 s. */
export const openMsOf = (bandMs: number): number => Math.max(OPEN_MS, 2 * bandMs)

/** Open until the record's own `expiresAt`; a record without one is open for `OPEN_MS` after `lastSeen`. */
export const isOpen = (s: SessionInfo | undefined, now: number): boolean => s !== undefined && now < (s.expiresAt ?? s.lastSeen + OPEN_MS)

export type Status = { text: string; waiting: boolean }

export type StatusContext = {
  registry: Registry
  sessions: Sessions
  root: string
  now: number
  tz: Tz
}

/** Origin and whether an agent is waiting, from the filing registry, session presence and a live watch claim. */
export function statusOf(e: ScanEntry, ctx: StatusContext): Status {
  const filing = ctx.registry[requestPathOf(ctx.root, e)]
  const watching = e.watch !== undefined && ctx.now - e.watch.heartbeatMs <= WATCH_LIVE_MS
  const watchText = e.watch === undefined ? '' : `an agent is watching (${e.watch.agent}, ${e.watch.machine})`
  if (filing !== undefined) {
    const session = ctx.sessions[filing.sessionId]
    const label = filing.label ?? session?.label ?? 'an earlier session'
    if (isOpen(session, ctx.now)) {
      let tail = 'session open, waiting for your answer'
      if (e.state === 'waiting') tail = 'session open, answer not collected yet'
      return { text: `asked by ${label} · ${tail}`, waiting: true }
    }
    if (watching) return { text: watchText, waiting: true }
    const seen = session?.lastSeen ?? filing.filedAt
    return { text: `asked by ${label} · session closed ${formatWhen(seen, ctx.now, ctx.tz)} — nobody waiting`, waiting: false }
  }
  if (watching) return { text: watchText, waiting: true }
  return { text: 'origin not recorded (filed before the inbox)', waiting: false }
}
