/** The /dtc pane: rows, layout, keys, props and the plain-text fallback. Pure: no `$`, no I/O. */

import { cleanLine } from './sanitise'
import { MORE_NOT_READ, countsText } from './text'
import { formatWhen } from './when'
import type { Tz } from './when'
import { whenMs } from './scan'
import type { ScanEntry } from './scan'
import type { Scope } from './paths'
import type { Status } from './presence'
import { SESSION_LABEL, isAnswered, isWaitingOnReviewer } from './session'
import type { SessionFiling, SessionState } from './session'

export const OLDER_MS = 14 * 86_400_000
export const PROPS_LIMIT = 90_000
const TITLE_CAP = 70

/** One listed record. `id` is `<project>/<path>.md`, the key the hooks resolve against a fresh scan. */
export type PaneRow = {
  id: string
  /** `s` filed from this session; `w` waiting to be collected; `x` an answer file that could not be read; `o` opened, not finished. */
  k: 's' | 'w' | 'x' | 'o'
  /** Title, already truncated to a sane width. */
  t: string
  /** When, in human form. */
  w: string
  /** Verdicts; empty for unfinished rows. For `s` rows, the state sentence. */
  v: string
  /** `s` rows: the state, for the text fallback's collect numbering. */
  st?: SessionState
  /** Unfinished and opened more than 14 days ago. */
  old?: true
  /** Origin and waiting status sentence. */
  s?: string
  /** An agent is actively waiting on this row. */
  a?: true
}

export type PaneProps = { scope: string; rows: PaneRow[]; /** How many file reads the scan put off to later scans; absent when none. */ more?: number }

export type ViewState = { selected: number; showOlder: boolean }
export type PaneAction = { kind: 'open' | 'collect'; id: string } | { kind: 'close' }
export type Tone = 'title' | 'heading' | 'row' | 'selected' | 'dim'
export type Line = { text: string; tone: Tone }

export const initialState = (): ViewState => ({ selected: 0, showOlder: false })

export const rowId = (e: { project: string; rel: string }): string => `${e.project}/${e.rel}`
const projectOf = (row: PaneRow): string => row.id.slice(0, row.id.indexOf('/'))

/** Truncates with an ellipsis so the result is at most `width` characters. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : width === 1 ? '…' : `${text.slice(0, width - 1).trimEnd()}…`
}

/** A title from the basename: leading date and project prefix removed, hyphens to spaces, first letter capital. */
export function titleFromBasename(project: string, rel: string): string {
  let name = (rel.slice(rel.lastIndexOf('/') + 1)).replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')
  if (name.startsWith(`${project}-`)) name = name.slice(project.length + 1)
  name = name.replace(/-/g, ' ').trim()
  return name === '' ? rel : name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * The record's own title (report, idea or release), else the request's frontmatter title or first
 * heading, else the basename. Record text: invisible, control and bidirectional characters removed, one line.
 */
export function entryTitle(e: ScanEntry): string {
  const own = cleanLine(e.title)
  if (own !== '') return own
  const asked = cleanLine(e.requestTitle)
  return asked !== '' ? asked : titleFromBasename(e.project, e.rel)
}

/** What an unreadable answer's row says, and the one line under the section's heading. */
export const UNREADABLE = 'could not read'
const UNREADABLE_WHY = 'Not a regular file, too large, or not in the expected shape. Never counted or collected.'

/** Waiting rows (given order), then unreadable answers, then unfinished rows newest first; props capped under the engine's limit. */
export function buildProps(
  waiting: readonly ScanEntry[],
  unfinished: readonly ScanEntry[],
  scope: Scope,
  now: number,
  tz: Tz,
  status?: (e: ScanEntry) => Status,
  filings: readonly SessionFiling[] = [],
  unreadable: readonly ScanEntry[] = [],
  /** How many file reads the scan put off to later scans. */
  unread = 0,
): PaneProps {
  const mark = (row: PaneRow, e: ScanEntry): PaneRow => {
    const st = status?.(e)
    if (st === undefined) return row
    // The status sentence carries a session label and a watch claim: text from outside, so cleaned.
    return { ...row, s: cleanLine(st.text), ...(st.waiting ? { a: true as const } : {}) }
  }
  const mine = new Set(filings.map(f => rowId(f.entry)))
  const rows: PaneRow[] = filings.map(f => ({
    id: rowId(f.entry),
    k: 's' as const,
    t: fit(entryTitle(f.entry), TITLE_CAP),
    w: formatWhen(f.filedAt, now, tz),
    v: SESSION_LABEL[f.state],
    st: f.state,
    ...(isWaitingOnReviewer(f.state) ? { a: true as const } : {}),
  }))
  rows.push(...waiting.filter(e => !mine.has(rowId(e))).map(e => mark({
    id: rowId(e),
    k: 'w',
    t: fit(entryTitle(e), TITLE_CAP),
    w: whenMs(e) > 0 ? formatWhen(whenMs(e), now, tz) : '',
    // A request row carries its verdict counts; an idea or release row the answer in a few words.
    v: e.kind === undefined ? countsText(e.counts, e.decisions) : (e.answer ?? ''),
  }, e)))
  rows.push(...unreadable.filter(e => !mine.has(rowId(e))).map(e => ({ id: rowId(e), k: 'x' as const, t: fit(entryTitle(e), TITLE_CAP), w: '', v: UNREADABLE })))
  const byRecent = unfinished.filter(e => !mine.has(rowId(e))).sort((a, b) => (b.sinceMs ?? 0) - (a.sinceMs ?? 0) || (a.rel < b.rel ? -1 : 1))
  for (const e of byRecent) {
    const since = e.sinceMs ?? 0
    const row: PaneRow = { id: rowId(e), k: 'o', t: fit(entryTitle(e), TITLE_CAP), w: since > 0 ? formatWhen(since, now, tz, true) : '', v: '' }
    if (since > 0 && now - since > OLDER_MS) row.old = true
    rows.push(mark(row, e))
  }
  return capProps({ scope: scope.kind === 'hub' ? 'all projects' : scope.project, rows, ...(unread > 0 ? { more: unread } : {}) })
}

/** The line shown when the scan put reads off: the list is not complete yet. Null when it is. */
export function moreLine(props: PaneProps): string | null {
  const n = props.more ?? 0
  if (n < 1) return null
  return `${MORE_NOT_READ.charAt(0).toUpperCase()}${MORE_NOT_READ.slice(1)}: ${n} ${n === 1 ? 'file is' : 'files are'} read over the next refreshes, and this list fills in.`
}

/** Drops rows from the end (the oldest unfinished first) until the props serialise under `limit` characters. */
export function capProps(props: PaneProps, limit = PROPS_LIMIT): PaneProps {
  let size = JSON.stringify({ scope: props.scope, rows: [] }).length
  const kept: PaneRow[] = []
  for (const row of props.rows) {
    size += JSON.stringify(row).length + 1
    if (size > limit) break
    kept.push(row)
  }
  return { scope: props.scope, rows: kept, ...(props.more === undefined ? {} : { more: props.more }) }
}

const sessionRows = (p: PaneProps): PaneRow[] => p.rows.filter(r => r.k === 's')
const waitingRows = (p: PaneProps): PaneRow[] => p.rows.filter(r => r.k === 'w')
const unreadableRows = (p: PaneProps): PaneRow[] => p.rows.filter(r => r.k === 'x')
const unfinishedRows = (p: PaneProps): PaneRow[] => p.rows.filter(r => r.k === 'o')
const olderCount = (p: PaneProps): number => p.rows.filter(r => r.old === true).length

/** The rows the pane shows and the keys move across, in display order. */
export function visibleRows(props: PaneProps, state: ViewState): PaneRow[] {
  return [...sessionRows(props), ...waitingRows(props), ...unreadableRows(props), ...unfinishedRows(props).filter(r => r.old !== true || state.showOlder)]
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

export function reduceKey(state: ViewState, key: string, props: PaneProps): { state: ViewState; action?: PaneAction } {
  const rows = visibleRows(props, state)
  const last = Math.max(0, rows.length - 1)
  const move = (to: number): { state: ViewState } => ({ state: { ...state, selected: clamp(to, 0, last) } })
  switch (key) {
    case 'up':
    case 'k':
      return move(state.selected - 1)
    case 'down':
    case 'j':
      return move(state.selected + 1)
    case 'home':
      return move(0)
    case 'end':
      return move(last)
    case 'return':
    case 'enter': {
      const row = rows[clamp(state.selected, 0, last)]
      return row === undefined ? { state } : { state, action: { kind: 'open', id: row.id } }
    }
    case 'c': {
      const row = rows[clamp(state.selected, 0, last)]
      return row === undefined ? { state } : { state, action: { kind: 'collect', id: row.id } }
    }
    case 'q':
      return { state, action: { kind: 'close' } }
    case 'a': {
      if (olderCount(props) === 0) return { state }
      const next: ViewState = { ...state, showOlder: !state.showOlder }
      return { state: { ...next, selected: clamp(state.selected, 0, Math.max(0, visibleRows(props, next).length - 1)) } }
    }
    default:
      return { state }
  }
}

function widths(rows: readonly PaneRow[], columns: number): { p: number; w: number; v: number; t: number } {
  const p = Math.min(22, Math.max(0, ...rows.map(r => projectOf(r).length)))
  const w = Math.max(0, ...rows.map(r => r.w.length))
  const v = Math.max(0, ...rows.map(r => r.v.length))
  const fixed = 3 + p + 2 + 2 + w + (v > 0 ? 2 + v : 0)
  return { p, w, v, t: Math.max(12, columns - 1 - fixed) }
}

/** Headings of the other sections say so once this session's section has rows. */
const others = (p: PaneProps): string => (sessionRows(p).length > 0 ? ' (other sessions)' : '')

const NO_SESSION = 'Nothing filed from this session yet.'

function unfinishedHeading(props: PaneProps, state: ViewState): string {
  const recent = unfinishedRows(props).length - olderCount(props)
  const older = olderCount(props)
  const tail = older === 0 ? '' : state.showOlder ? `  (${older} older than two weeks shown — a to hide)` : `  (${older} older than two weeks — a to show)`
  const waitingOn = unfinishedRows(props).filter(r => r.a === true).length
  const agents = waitingOn === 0 ? '' : ` · ${waitingOn} ${waitingOn === 1 ? 'agent' : 'agents'} waiting`
  return ` Opened by you, not finished${others(props)} · ${recent} recent${agents}${tail}`
}

/** The pane for one state: header, a body window that follows the selection, footer. */
export function renderPane(props: PaneProps, state: ViewState, columns: number, height: number): Line[] {
  const width = Math.max(40, columns - 1)
  const rows = visibleRows(props, state)
  const w = widths(rows.filter(r => r.k !== 's'), width + 1)
  const mine = sessionRows(props)
  const p = Math.min(22, Math.max(w.p, ...mine.map(r => projectOf(r).length)))
  const sv = Math.max(0, ...mine.map(r => r.v.length))
  const sw = Math.max(0, ...mine.map(r => r.w.length))
  const st = Math.max(12, width - (3 + p + 2 + 2 + sv + 2 + sw))
  const sel = clamp(state.selected, 0, Math.max(0, rows.length - 1))
  const body: Line[] = []
  let selLine = 0
  let index = 0
  const addRow = (row: PaneRow): void => {
    const isSel = index === sel
    const lead = `${row.a === true ? '●' : ' '}${isSel ? '❯' : ' '} ${fit(projectOf(row), p).padEnd(p)}  `
    const text = row.k === 's'
      ? `${lead}${fit(row.t, st).padEnd(st)}  ${row.v.padEnd(sv)}  ${row.w}`
      : `${lead}${fit(row.t, w.t).padEnd(w.t)}  ${row.w.padEnd(w.w)}${w.v > 0 ? `  ${row.v}` : ''}`
    if (isSel) selLine = body.length
    body.push({ text: isSel ? fit(text, width).padEnd(width) : fit(text.trimEnd(), width), tone: isSel ? 'selected' : 'row' })
    if (isSel && row.s !== undefined && row.s !== '') body.push({ text: fit(`      ${row.s}`, width), tone: 'dim' })
    index++
  }
  const waiting = waitingRows(props)
  const unfinished = unfinishedRows(props)
  const more = moreLine(props)
  if (more !== null) body.push({ text: fit(` ${more}`, width), tone: 'dim' }, { text: '', tone: 'dim' })
  body.push({ text: ` From this session · ${mine.length}`, tone: 'heading' })
  if (mine.length === 0) body.push({ text: `   ${NO_SESSION}`, tone: 'dim' })
  else mine.forEach(addRow)
  body.push({ text: '', tone: 'dim' })
  if (waiting.length === 0) body.push({ text: ` No DTC answers waiting${others(props)}.`, tone: 'heading' })
  else {
    body.push({ text: ` Waiting to be collected${others(props)} · ${waiting.length}`, tone: 'heading' })
    waiting.forEach(addRow)
  }
  const unread = unreadableRows(props)
  if (unread.length > 0) {
    body.push({ text: '', tone: 'dim' })
    body.push({ text: ` Could not read${others(props)} · ${unread.length}`, tone: 'heading' })
    body.push({ text: fit(`   ${UNREADABLE_WHY}`, width), tone: 'dim' })
    unread.forEach(addRow)
  }
  if (unfinished.length > 0) {
    body.push({ text: '', tone: 'dim' })
    body.push({ text: fit(unfinishedHeading(props, state), width), tone: 'heading' })
    unfinished.filter(r => r.old !== true || state.showOlder).forEach(addRow)
  }
  const keys = ['enter open in DTC', 'c collect prompt']
  if (olderCount(props) > 0) keys.push(state.showOlder ? 'a hide older' : 'a show older')
  keys.push('q close')
  const header: Line[] = [{ text: fit(`DTC — answers waiting (${props.scope})`, width), tone: 'title' }, { text: '', tone: 'dim' }]
  const footer: Line[] = [{ text: '', tone: 'dim' }, { text: fit(` ${keys.join(' · ')}`, width), tone: 'dim' }]
  const room = Math.max(5, height - header.length - footer.length)
  const start = body.length <= room ? 0 : clamp(selLine - Math.floor(room / 2), 0, body.length - room)
  return [...header, ...body.slice(start, start + room), ...footer]
}

/** The same content as plain aligned text; answered rows (this session's first, then the waiting ones) are numbered as `/dtc collect n` counts them. */
export function fallbackText(props: PaneProps): string {
  const mine = sessionRows(props)
  const waiting = waitingRows(props)
  const unfinished = unfinishedRows(props)
  const recent = unfinished.filter(r => r.old !== true)
  const older = olderCount(props)
  const unread = unreadableRows(props)
  const shown = [...mine, ...waiting, ...unread, ...recent]
  const p = Math.min(22, Math.max(0, ...shown.map(r => projectOf(r).length)))
  const t = Math.min(50, Math.max(0, ...shown.map(r => r.t.length)))
  const w = Math.max(0, ...shown.map(r => r.w.length))
  const sv = Math.max(0, ...mine.map(r => r.v.length))
  const link = (lead: string, r: PaneRow): string => `${' '.repeat(lead.length)}dtc://open/${r.id}`
  const line = (lead: string, r: PaneRow): string[] => [
    r.k === 's'
      ? `${lead}${r.a === true ? '● ' : ''}${fit(projectOf(r), p).padEnd(p)}  ${fit(r.t, t).padEnd(t)}  ${r.v.padEnd(sv)}  ${r.w}`.trimEnd()
      : `${lead}${fit(projectOf(r), p).padEnd(p)}  ${fit(r.t, t).padEnd(t)}  ${r.w.padEnd(w)}${r.v === '' ? '' : `  ${r.v}`}`.trimEnd(),
    ...(r.s === undefined || r.s === '' ? [] : [`${' '.repeat(lead.length)}${r.a === true ? '● ' : ''}${r.s}`]),
    link(lead, r),
  ]
  let n = 0
  const numbered = (r: PaneRow): string => `${String(++n).padStart(2)}. `
  const more = moreLine(props)
  const out: string[] = [`DTC — answers waiting (${props.scope})`, '', ...(more === null ? [] : [more, '']), `From this session · ${mine.length}`]
  if (mine.length === 0) out.push(NO_SESSION)
  for (const r of mine) out.push(...line(r.st !== undefined && isAnswered(r.st) ? numbered(r) : '  - ', r))
  out.push('')
  if (waiting.length === 0) out.push(`No DTC answers waiting${others(props)}.`)
  else {
    out.push(`Waiting to be collected${others(props)} · ${waiting.length}`)
    for (const r of waiting) out.push(...line(numbered(r), r))
  }
  if (n > 0) out.push('', '/dtc collect [n] fills the prompt box with the collect prompt for item n.')
  if (unread.length > 0) {
    out.push('', `Could not read${others(props)} · ${unread.length}`, UNREADABLE_WHY)
    unread.forEach(r => out.push(...line('  - ', r)))
  }
  if (unfinished.length > 0) {
    out.push('', `Opened by you, not finished${others(props)} · ${recent.length} recent${older > 0 ? `  (${older} older than two weeks not listed)` : ''}`)
    recent.forEach(r => out.push(...line('  - ', r)))
  }
  return out.join('\n')
}
