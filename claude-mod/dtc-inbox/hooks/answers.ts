/**
 * The dtc_answers tool: a report, a roadmap idea or a release answers file to the normalised answers
 * the model reads. Every string taken from a record is cleaned and capped (`sanitise.ts`), lists
 * are capped, and the result is handed over as quoted data (`answersText`). Pure.
 */

import { hasTraversal } from './guard'
import { ideaReply, releaseVerdicts } from './records'
import { decisionsOf, hasReportShape, isFinal, isValidCompletion, itemsOf, parseJson } from './reports'
import type { RequestRef } from './paths'
import { dtcUrl } from './paths'
import { RESULT_MAX, clean, cleanLine, quoteData } from './sanitise'

type Json = Record<string, unknown>

/** The most entries kept of any one list in a record (items, quotes, marks, verdicts and the rest). */
export const LIST_MAX = 200
/** The most screenshot paths given for one release verdict. */
export const SHOTS_MAX = 20

/** A long field: the reviewer's words, cleaned and capped. */
const str = (v: unknown): string => clean(v)
/** A short field: an id, a title, a name. */
const label = (v: unknown, max?: number): string => cleanLine(v, max)
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0)
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)).slice(0, LIST_MAX) : [])

const STATUSES = ['pass', 'partial', 'fail', 'skip']
const PICTURE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._ -]*$/

/**
 * A picture name as a report gives it, kept only when it is a plain relative path (at most four
 * segments of letters, digits, `.`, `_`, `-` and spaces; no `..`, no leading `/` or `~`): it names
 * a file beside the record, inside the records folder. Anything else reads as `''`.
 */
export function pictureName(v: unknown): string {
  if (typeof v !== 'string' || v === '' || v.length > 300 || hasTraversal(v)) return ''
  const parts = v.split('/')
  return parts.length <= 4 && parts.every(part => PICTURE_SEGMENT.test(part)) ? v : ''
}

/** One mark the reviewer drew on a picture: its number, its shape and exactly what was typed (may be empty). */
export type Mark = { n: number | null; shape: string; text: string }

/** One picture the reviewer marked up. */
export type Markup = {
  /** The original picture, as the report names it. */
  picture: string
  /** The copy with the shapes drawn in, as the report names it. */
  marked: string
  /** Where the words sit on the marked copy: `picture` (labels joined to the marks) or `list` (numbered pins; also what a record without the field has). */
  notes: 'picture' | 'list'
  /** On a decision: the option whose picture this is. Absent elsewhere. */
  option?: string
  marks: Mark[]
  /** How many of `picture` and `marked` were left out because the name is not a plain relative path. Absent when none. */
  namesWithheld?: number
}

/** The markups on an item, a decision or an observation, with every mark's words. */
export function markupsOf(holder: Json): Markup[] {
  return list(holder.markups).map(m => {
    const picture = pictureName(m.picture)
    const marked = pictureName(m.marked)
    const withheld = [[m.picture, picture], [m.marked, marked]].filter(([given, kept]) => typeof given === 'string' && given !== '' && kept === '').length
    return {
      picture,
      marked,
      notes: m.notes === 'picture' ? ('picture' as const) : ('list' as const),
      ...(label(m.option) !== '' ? { option: label(m.option) } : {}),
      marks: list(m.marks).map(k => ({ n: typeof k.n === 'number' && Number.isFinite(k.n) ? k.n : null, shape: label(k.shape, 40), text: str(k.text) })),
      ...(withheld > 0 ? { namesWithheld: withheld } : {}),
    }
  })
}

export type NormalisedAnswers = {
  request: string
  link: string
  title: string
  completedAt: string
  isCollected: boolean
  mode: string
  items: Array<{
    id: string
    title: string
    status: string
    comment: string
    flagged: Array<{ expectedIndex: number | null; text: string; comment: string }>
    quotes: Array<{ text: string; comment: string }>
    screenshots: number
    markups: Markup[]
    decisions: Array<{ id: string; question: string; choice: string | null; comment: string; markups: Markup[] }>
  }>
  observations: Array<{ id: string; text: string; screenshots: number; markups: Markup[] }>
}

export type AnswersResult = { ok: true; answers: NormalisedAnswers } | { ok: false; message: string }

const nameOf = (ref: RequestRef): string => `${ref.project}/${ref.rel.replace(/\.md$/, '')}`

/**
 * Normalises a final report. Errors plainly when it is missing, malformed or not final. With
 * `when`, a `completedAt` in the future, or earlier than the request was filed, is not final.
 */
export function normaliseAnswers(ref: RequestRef, reportText: string | null, isCollected: boolean, when?: { now: number; filedAt?: number }): AnswersResult {
  const name = nameOf(ref)
  if (reportText === null) return { ok: false, message: `No report for ${name}: the reviewer has not opened or answered it yet.` }
  const report: Json | null = parseJson(reportText)
  if (report === null) return { ok: false, message: `The report for ${name} could not be read (malformed or half-written); try again shortly.` }
  if (isFinal(report) && !hasReportShape(report)) return { ok: false, message: `The report for ${name} could not be read: it is not in the shape Dev Traffic Control writes.` }
  if (!isFinal(report)) return { ok: false, message: `The report for ${name} is not final (no valid completedAt): the reviewer is still answering. Do not read partial answers unless the reviewer says so.` }
  if (when !== undefined && !isValidCompletion(report.completedAt, when.now, when.filedAt)) {
    return { ok: false, message: `The report for ${name} has a completedAt that is in the future or earlier than the request was filed, so it is not treated as final.` }
  }
  return {
    ok: true,
    answers: {
      request: name,
      link: dtcUrl(ref),
      title: label(report.title),
      completedAt: label(report.completedAt, 40),
      isCollected,
      mode: label(report.mode, 40),
      items: itemsOf(report).slice(0, LIST_MAX).map(item => ({
        id: label(item.id),
        title: label(item.title),
        status: typeof item.status === 'string' && STATUSES.includes(item.status) ? item.status : 'unanswered',
        comment: str(item.comment),
        flagged: list(item.flagged).map(f => ({ expectedIndex: typeof f.expectedIndex === 'number' ? f.expectedIndex : null, text: str(f.text), comment: str(f.comment) })),
        quotes: list(item.quotes).map(q => ({ text: str(q.text), comment: str(q.comment) })),
        screenshots: count(item.screenshots),
        markups: markupsOf(item),
        decisions: decisionsOf(item).slice(0, LIST_MAX).map(d => ({
          id: label(d.id),
          question: str(d.question),
          choice: str(d.choice) === '' ? null : str(d.choice),
          comment: str(d.comment),
          markups: markupsOf(d),
        })),
      })),
      observations: list(report.observations).map(o => ({ id: label(o.id), text: str(o.text), screenshots: count(o.screenshots), markups: markupsOf(o) })),
    },
  }
}

/** A feature request's waiting reply, as the model reads it. */
export type IdeaAnswer = {
  kind: 'feature-request'
  idea: string
  link: string
  title: string
  /** The reviewer entry's answer (its heading's last part); `''` when the heading gives none. */
  answer: string
  /** The reviewer's words under the heading. */
  note: string
  /** The entry's date as written; `''` when the heading gives none. */
  at: string
  /** The idea's current `fate`; `''` when unset or not one of the contract's values. */
  fate: string
  /** The release the idea is currently aimed at; `''` when unset. */
  candidate: string
}

export type IdeaResult = { ok: true; answers: IdeaAnswer } | { ok: false; message: string }

/** Normalises an idea file's waiting reviewer entry. Errors plainly when the file is missing, unreadable or has no entry waiting. */
export function normaliseIdea(ref: RequestRef, ideaText: string | null): IdeaResult {
  const name = nameOf(ref)
  if (ideaText === null) return { ok: false, message: `The idea file for ${name} is missing or could not be read (or is larger than the inbox reads).` }
  const reply = ideaReply(ideaText)
  if (reply === null) return { ok: false, message: `No reviewer entry is waiting on ${name}: the idea has no entries, or its last entry is the agent's.` }
  return {
    ok: true,
    answers: {
      kind: 'feature-request',
      idea: ref.rel.replace(/^roadmap\//, '').replace(/\.md$/, ''),
      link: dtcUrl(ref),
      title: label(reply.title),
      answer: label(reply.answer, 500),
      note: str(reply.note),
      at: label(reply.at, 40),
      fate: reply.fate,
      candidate: label(reply.candidate, 60),
    },
  }
}

/** Release verdicts, as the model reads them. */
export type VerdictAnswers = {
  kind: 'release-verdicts'
  release: string
  link: string
  app: string
  version: string
  /** The newest verdict's time, as written; `''` when no verdict carries one. */
  newestAt: string
  verdicts: Array<{
    id: string
    verdict: 'works' | 'off'
    comment: string
    at: string
    /** Absolute paths of the pictures attached to the verdict that lie inside the records folder. */
    screenshots: string[]
    /** Pictures the answers file names that were left out: a path that leaves the records folder, or no file there. */
    screenshotsWithheld: number
    removed?: true
  }>
}

export type VerdictResult = { ok: true; answers: VerdictAnswers; stamp: string | null } | { ok: false; message: string }

/**
 * The absolute path a verdict's picture names: relative to the project folder, as the contract
 * writes it. Null for an absolute path, one that spells traversal, or one with characters outside
 * `pictureName`'s; whether it is a regular file inside the records folder is the caller's check
 * (`pictureExists`).
 */
export function shotPath(root: string, project: string, shot: string): string | null {
  if (shot.startsWith('/') || shot.startsWith('~') || pictureName(shot) === '') return null
  return `${root}/${project}/${shot}`
}

/**
 * Normalises a release answers file. Errors plainly when it is missing or unreadable. A picture
 * path is given only when `shotPath` accepts it and `pictureExists` (the confined regular-file
 * check: inside the records folder, no symbolic link on the way) says so; at most `SHOTS_MAX` per verdict.
 */
export async function normaliseVerdicts(
  ref: RequestRef,
  answersText: string | null,
  root: string,
  pictureExists: (path: string) => Promise<boolean>,
): Promise<VerdictResult> {
  const name = nameOf(ref)
  if (answersText === null) return { ok: false, message: `No verdicts for ${name}: the reviewer has not answered any feature of this release yet (or the answers file is larger than the inbox reads).` }
  const v = releaseVerdicts(answersText)
  if (v === null) return { ok: false, message: `The answers file for ${name} could not be read (malformed or half-written); try again shortly.` }
  const verdicts: VerdictAnswers['verdicts'] = []
  for (const a of v.answers.slice(0, LIST_MAX)) {
    const screenshots: string[] = []
    for (const shot of a.screenshots.slice(0, SHOTS_MAX)) {
      const path = shotPath(root, ref.project, shot)
      if (path !== null && (await pictureExists(path).catch(() => false))) screenshots.push(path)
    }
    verdicts.push({
      id: label(a.id),
      verdict: a.verdict,
      comment: str(a.comment),
      at: label(a.at, 40),
      screenshots,
      screenshotsWithheld: a.screenshots.length - screenshots.length,
      ...(a.removed === true ? { removed: true as const } : {}),
    })
  }
  return {
    ok: true,
    stamp: v.stamp,
    answers: { kind: 'release-verdicts', release: name, link: dtcUrl(ref), app: label(v.app), version: label(v.release), newestAt: v.stamp ?? '', verdicts },
  }
}

/** Every string in a value cut again to `max` characters. */
function recap(value: unknown, max: number): unknown {
  if (typeof value === 'string') return clean(value, max)
  if (Array.isArray(value)) return value.map(v => recap(v, max))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, recap(v, max)]))
  return value
}

const render = (value: unknown): string => quoteData(JSON.stringify(value, null, 2))

/** Keeps the leading entries of each top-level list that fit `budget` characters; says how many were left out. */
function trimLists(value: Record<string, unknown>, budget: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value }
  const lists = Object.keys(value).filter(k => Array.isArray(value[k]))
  for (const k of lists) out[k] = []
  let used = render(out).length + 200
  const omitted: Record<string, number> = {}
  for (const k of lists) {
    const all = value[k] as unknown[]
    const kept: unknown[] = []
    for (const el of all) {
      const text = JSON.stringify(el, null, 2)
      // Nested two levels down: four more spaces a line, a comma and a line end; marker look-alikes grow by one.
      const size = text.length + 4 * (text.split('\n').length + 1) + 2 + (text.match(/<<<|>>>/g)?.length ?? 0)
      if (used + size > budget) break
      used += size
      kept.push(el)
    }
    out[k] = kept
    if (kept.length < all.length) omitted[k] = all.length - kept.length
  }
  return Object.keys(omitted).length === 0 ? out : { ...out, omitted, omittedNote: 'Entries were left out to fit; the whole answer is in the record, in the Dev Traffic Control app.' }
}

/**
 * What `dtc_answers` returns: the fixed preamble, then the answers as JSON between the two marker
 * lines (`quoteData`), at most `RESULT_MAX` characters in all. An answer that would be longer has
 * every text field cut to 2,000 characters, then to 500, and then loses trailing list entries,
 * each step saying so inside the data.
 */
export function answersText(a: NormalisedAnswers | IdeaAnswer | VerdictAnswers): string {
  let value: Record<string, unknown> = a
  let text = render(value)
  for (const max of [2000, 500]) {
    if (text.length <= RESULT_MAX) return text
    value = { ...(recap(a, max) as Record<string, unknown>), cutNote: `Every text field was cut to ${max} characters to fit; the whole answer is in the record.` }
    text = render(value)
  }
  if (text.length <= RESULT_MAX) return text
  value = trimLists(value, RESULT_MAX)
  text = render(value)
  // The estimate above is close, not exact: drop one more entry at a time until it fits.
  while (text.length > RESULT_MAX) {
    const key = Object.keys(value).reverse().find(k => Array.isArray(value[k]) && (value[k] as unknown[]).length > 0)
    if (key === undefined) break
    value = { ...value, [key]: (value[key] as unknown[]).slice(0, -1) }
    text = render(value)
  }
  return text.length <= RESULT_MAX ? text : quoteData(JSON.stringify({ omittedNote: 'This answer is too large to hand over; read it in the Dev Traffic Control app.' }, null, 2))
}
