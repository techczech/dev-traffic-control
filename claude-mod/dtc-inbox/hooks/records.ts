/**
 * The two answers that are not a finished request: the reviewer's reply on a feature request
 * (a roadmap idea file, `<project>/roadmap/<id>.md`) and release verdicts
 * (`<project>/releases/<version>.answers.json`). Text in, plain values out. Pure; never throws.
 */

import { parseJson, isoTime } from './reports'
import { cleanLine } from './sanitise'

/** The most bytes read of one idea file; a larger one is treated as unreadable. The app caps one entry at 8 KB. */
export const MAX_IDEA_BYTES = 256 * 1024
/** The most bytes read of one release answers file; a larger one is treated as unreadable. */
export const MAX_VERDICTS_BYTES = 1024 * 1024
/** The most characters of an answer or note carried into the pane's props. */
const SHORT = 80

const FATES = ['waiting', 'planned', 'building', 'built', 'merged', 'declined']

export type Entry = {
  by: 'reviewer' | 'agent'
  /** `YYYY-MM-DD` as written; `''` when the heading carries none. */
  at: string
  /** What the heading says after the date; `''` when it says nothing. */
  answer: string
  /** The words under the heading. */
  note: string
}

const ENTRY_HEADING = /^##[ \t]+(Reviewer|Agent) entry(?:[ \t]*·[ \t]*([^·\n]*?))?(?:[ \t]*·[ \t]*([^\n]*?))?[ \t]*$/gim

/**
 * The entries an idea's body carries, oldest first: `## Reviewer entry · <date> · <answer>` and
 * `## Agent entry · <date>` headings, each with the text under it. A heading with a date and no
 * answer, or with neither, is an entry with those parts empty.
 */
export function readEntries(body: string): Entry[] {
  const matches = [...body.matchAll(ENTRY_HEADING)]
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? ((matches[index + 1] as RegExpMatchArray).index ?? body.length) : body.length
    const first = (match[2] ?? '').trim()
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(first)
    const rest = (match[3] ?? '').trim()
    return {
      by: (match[1] as string).toLowerCase() === 'agent' ? ('agent' as const) : ('reviewer' as const),
      at: dated ? first : '',
      answer: dated ? rest : [first, rest].filter(part => part !== '').join(' · '),
      note: body.slice(start, end).trim(),
    }
  })
}

/** The frontmatter block's top-level `key: value` lines (quotes removed) and the body after it. */
function splitIdea(markdown: string): { keys: Record<string, string>; body: string } {
  const keys: Record<string, string> = {}
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)
  if (fm === null) return { keys, body: markdown }
  for (const line of (fm[1] as string).split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(line)
    if (m === null) continue
    keys[m[1] as string] = (m[2] as string).replace(/^(["'])(.*)\1$/, '$2')
  }
  return { keys, body: markdown.slice(fm[0].length) }
}

/** A reviewer entry that no agent entry follows: an answer waiting for the agent. */
export type IdeaReply = {
  /** The idea's title from its frontmatter; `''` when it has none. */
  title: string
  /** `waiting | planned | building | built | merged | declined`, or `''` (none, or a value outside the list). */
  fate: string
  /** The release the idea is aimed at; `''` when unset. */
  candidate: string
  /** The entry's answer (the heading's last part); may be `''`. */
  answer: string
  /** The reviewer's words under the heading; may be `''`. */
  note: string
  /** The entry's date as written, `YYYY-MM-DD`; `''` when the heading has none. */
  at: string
  /**
   * Names this entry among the file's entries: its position among the reviewer's entries and its
   * date. A later reviewer entry has a different stamp; an agent's edit elsewhere in the file
   * leaves it unchanged.
   */
  stamp: string
}

/** The reply an idea file is waiting on, or null when its last entry is the agent's or it has none. */
export function ideaReply(markdown: string | null): IdeaReply | null {
  if (markdown === null) return null
  try {
    const { keys, body } = splitIdea(markdown)
    const entries = readEntries(body)
    const last = entries[entries.length - 1]
    if (last === undefined || last.by !== 'reviewer') return null
    const ordinal = entries.filter(e => e.by === 'reviewer').length
    const fate = (keys.fate ?? '').toLowerCase()
    return {
      title: keys.title ?? '',
      fate: FATES.includes(fate) ? fate : '',
      candidate: keys.candidate ?? '',
      answer: last.answer,
      note: last.note,
      at: last.at,
      stamp: `reviewer-entry-${ordinal}${last.at === '' ? '' : `-${last.at}`}`,
    }
  } catch {
    return null
  }
}

export type Verdict = {
  id: string
  verdict: 'works' | 'off'
  comment: string
  /** When the verdict was given, as written (ISO-8601); `''` when absent. */
  at: string
  /** Pictures attached to the verdict, relative to the project folder, as written. */
  screenshots: string[]
  /** The feature's heading has since been removed from the release record. */
  removed?: true
}

export type ReleaseVerdicts = {
  app: string
  release: string
  answers: Verdict[]
  /** The newest valid `at` among the answers, as written: names this set of verdicts. Null when no answer carries a valid time. */
  stamp: string | null
  /** Epoch ms of `stamp`; 0 when there is none. */
  atMs: number
}

const scalar = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

/**
 * A release answers file, read as the app reads it: `app`, `release` and `answers[]` are required;
 * an answer needs an `id` and a verdict of `works` or `off`, any other is dropped. Null for
 * anything else (missing, malformed, half-written).
 */
export function releaseVerdicts(text: string | null): ReleaseVerdicts | null {
  const parsed = parseJson(text)
  if (parsed === null || !Array.isArray(parsed.answers)) return null
  const app = scalar(parsed.app)
  const release = scalar(parsed.release)
  if (app === '' || release === '') return null
  const answers: Verdict[] = []
  let stamp: string | null = null
  let atMs = 0
  for (const candidate of parsed.answers as unknown[]) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const c = candidate as Record<string, unknown>
    const id = scalar(c.id)
    const verdict = scalar(c.verdict)
    if (id === '' || (verdict !== 'works' && verdict !== 'off')) continue
    const at = scalar(c.at)
    const t = isoTime(at)
    if (t !== null && t > atMs) {
      atMs = t
      stamp = at
    }
    answers.push({
      id,
      verdict,
      comment: typeof c.comment === 'string' ? c.comment : '',
      at,
      screenshots: Array.isArray(c.screenshots) ? c.screenshots.filter((s): s is string => typeof s === 'string' && s !== '') : [],
      ...(c.removed === true ? { removed: true as const } : {}),
    })
  }
  return { app, release, answers, stamp, atMs }
}

/** A few words for a list row: stripped of invisible and control characters, one line. */
const short = (text: string): string => cleanLine(text, SHORT)

/** What a scan keeps of an idea file that is waiting on the agent. */
export type IdeaSummary = { k: 'idea'; title: string; stamp: string; answer: string }

export function summariseIdea(reply: IdeaReply): IdeaSummary {
  return { k: 'idea', title: short(reply.title), stamp: reply.stamp, answer: short(reply.answer === '' ? reply.note : reply.answer) || 'reviewer entry' }
}

/** What a scan keeps of a release answers file. */
export type VerdictSummary = { k: 'release'; app: string; release: string; stamp: string | null; atMs: number; answer: string }

export function summariseVerdicts(v: ReleaseVerdicts): VerdictSummary {
  const live = v.answers.filter(a => a.removed !== true)
  const works = live.filter(a => a.verdict === 'works').length
  const off = live.length - works
  const parts = [works > 0 ? `${works} works` : '', off > 0 ? `${off} off` : ''].filter(p => p !== '')
  return { k: 'release', app: short(v.app), release: short(v.release), stamp: v.stamp, atMs: v.atMs, answer: parts.length === 0 ? 'no verdicts' : parts.join(' · ') }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A cached value read back as an idea summary; null for any other shape. */
export function asIdeaSummary(v: unknown): IdeaSummary | null {
  if (!isObj(v) || v.k !== 'idea' || typeof v.title !== 'string' || typeof v.stamp !== 'string' || typeof v.answer !== 'string') return null
  return { k: 'idea', title: v.title, stamp: v.stamp, answer: v.answer }
}

/** A cached value read back as a verdict summary; null for any other shape. */
export function asVerdictSummary(v: unknown): VerdictSummary | null {
  if (!isObj(v) || v.k !== 'release' || typeof v.app !== 'string' || typeof v.release !== 'string' || typeof v.answer !== 'string') return null
  if (!(typeof v.stamp === 'string' || v.stamp === null) || typeof v.atMs !== 'number' || !Number.isFinite(v.atMs)) return null
  return { k: 'release', app: v.app, release: v.release, stamp: v.stamp, atMs: v.atMs, answer: v.answer }
}
