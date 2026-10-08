import type { PoolIdea } from '../../../main/qa/pool'
import { isFeatureRequest, type RequestFate } from '../../../main/qa/featureRequest'
import { versionCore } from '../../../shared/releaseVersionOrder'

/**
 * What a feature request's fate means to the reader: the group it
 * sits in, the words on its chip, whether it is owed to the reviewer, and the entries
 * the reviewer and the agent leave in the idea's body. Pure; the tab, the Waiting row
 * and the record chips all read it, so they cannot disagree.
 */

export type RequestGroup = 'waiting' | 'none' | 'planned' | 'finished'

/** The order the tab lists the groups in. */
export const REQUEST_GROUPS: readonly RequestGroup[] = ['waiting', 'none', 'planned', 'finished']

export const REQUEST_GROUP_LABELS: Record<RequestGroup, string> = {
  waiting: 'Waiting on you',
  none: 'No plan yet',
  planned: 'On the roadmap',
  finished: 'Finished'
}

export function groupOfFate(fate: RequestFate | undefined): RequestGroup {
  switch (fate) {
    case 'waiting':
      return 'waiting'
    case 'planned':
    case 'building':
      return 'planned'
    case 'built':
    case 'merged':
    case 'declined':
      return 'finished'
    default:
      return 'none'
  }
}

/** The release a fate chip names: the note's "in <release>", else the candidate. */
export function releaseOfIdea(idea: Pick<PoolIdea, 'candidateRelease' | 'request'>): string {
  const fromNote = idea.request?.fateNote?.match(/\bin\s+v?(\d[\w.+-]*\d|\d)/i)?.[1]
  return (fromNote ?? idea.candidateRelease ?? '').replace(/[.,;]+$/, '')
}

/** The fate chip's words. An unknown or missing fate is "No plan yet". */
export function fateLabel(
  idea: Pick<PoolIdea, 'candidateRelease' | 'request'>,
  pending = ''
): string {
  const release = releaseOfIdea(idea)
  switch (idea.request?.fate) {
    case 'waiting':
      return 'Waiting on you'
    case 'planned':
      // Approved ideas sit on the Roadmap; the chip names where.
      if (!release) return 'On the roadmap'
      return `On the roadmap · ${release}${pending && versionCore(release) === pending ? ' (pending)' : ''}`
    case 'building':
      return release ? `Building in ${release}` : 'Building'
    case 'built':
      return release ? `Built in ${release}` : 'Built'
    case 'merged':
      return 'Merged'
    case 'declined':
      return 'Declined'
    default:
      return 'No plan yet'
  }
}

// --- entries in the idea's body ----------------------------------------------

export type EntryAuthor = 'reviewer' | 'agent'

export interface RequestEntry {
  by: EntryAuthor
  /** `YYYY-MM-DD` as written; `''` when the heading carries none. */
  at: string
  /** What the reviewer chose, or the agent's heading: "Approved the plan". */
  answer: string
  /** The reviewer's words under the heading. */
  note: string
}

const ENTRY_HEADING =
  /^##[ \t]+(Reviewer|Agent) entry(?:[ \t]*·[ \t]*([^·\n]*?))?(?:[ \t]*·[ \t]*([^\n]*?))?[ \t]*$/gim

/** The entries a body carries, oldest first, and the text before the first. */
export function readEntries(body: string): { intro: string; entries: RequestEntry[] } {
  const matches = [...body.matchAll(ENTRY_HEADING)]
  if (matches.length === 0) return { intro: body, entries: [] }
  const entries = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? body.length) : body.length
    const first = match[2]?.trim() ?? ''
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(first)
    return {
      by: match[1].toLowerCase() as EntryAuthor,
      at: dated ? first : '',
      answer: (dated ? (match[3] ?? '') : [first, match[3]].filter(Boolean).join(' · ')).trim(),
      note: body.slice(start, end).trim()
    }
  })
  return { intro: body.slice(0, matches[0].index ?? 0).trimEnd(), entries }
}

/** One reviewer entry as text: heading, then the reviewer's words when given. */
export function reviewerEntryText(entry: { answer: string; note: string; at: string }): string {
  const heading = `## Reviewer entry · ${entry.at} · ${entry.answer}`
  return entry.note.trim() ? `${heading}\n\n${entry.note.trim()}` : heading
}

/** The body with one more reviewer entry at the end. */
export function withReviewerEntry(
  body: string,
  entry: { answer: string; note: string; at: string }
): string {
  const section = reviewerEntryText(entry)
  const base = body.trimEnd()
  return `${base ? `${base}\n\n` : ''}${section}\n`
}

/** The reviewer's last word when nothing from the agent follows it; else `undefined`. */
export function unansweredReply(entries: readonly RequestEntry[]): RequestEntry | undefined {
  const last = entries[entries.length - 1]
  return last?.by === 'reviewer' ? last : undefined
}

// --- owed ---------------------------------------------------------------------

/**
 * A request is owed by the reviewer when it is the reviewer's, its fate is `waiting`, and the reviewer has
 * not already answered since the agent last spoke. One test, read by the tab,
 * the Dash row, the tab bar's rail count and the record chips.
 */
export function isRequestIdeaOwed(idea: PoolIdea): boolean {
  if (!isFeatureRequest(idea.request) || idea.request?.fate !== 'waiting') return false
  if (idea.state === 'setaside') return false
  return !unansweredReply(readEntries(idea.bodyMarkdown).entries)
}

// --- what the reviewer can do -----------------------------------------------------------

export type RequestActionId =
  | 'approve'
  | 'change'
  | 'not-now'
  | 'move'
  | 'try'
  | 'not-right'
  | 'fold'
  | 'open-roadmap'
  | 'take-off'

export interface RequestAction {
  id: RequestActionId
  label: string
  /** The words written into the entry heading. */
  answer: string
  /** Asks for a sentence (or a release) before it is sent. */
  asks: 'none' | 'text' | 'release'
  primary: boolean
}

const ACTIONS: Record<RequestActionId, Omit<RequestAction, 'primary'>> = {
  // The reviewer's yes: the idea goes onto the Roadmap in the pending release.
  approve: {
    id: 'approve',
    label: 'Approve → Roadmap',
    answer: 'Approved for the roadmap',
    asks: 'none'
  },
  // Not an answer: it opens the Roadmap tab.
  'open-roadmap': {
    id: 'open-roadmap',
    label: 'Open on the Roadmap',
    answer: '',
    asks: 'none'
  },
  'take-off': {
    id: 'take-off',
    label: 'Take it off the roadmap',
    answer: 'Took it off the roadmap',
    asks: 'none'
  },
  change: { id: 'change', label: 'Change it', answer: 'Wants the plan changed', asks: 'text' },
  'not-now': { id: 'not-now', label: 'Not now', answer: 'Not now', asks: 'none' },
  move: {
    id: 'move',
    label: 'Move to another release',
    answer: 'Move to another release',
    asks: 'release'
  },
  try: { id: 'try', label: 'Try it', answer: 'Tried it, it works', asks: 'none' },
  'not-right': {
    id: 'not-right',
    label: 'It is not right',
    answer: 'It is not right',
    asks: 'text'
  },
  fold: { id: 'fold', label: 'Fold it away', answer: 'Fold it away', asks: 'none' }
}

const ACTIONS_BY_FATE: Partial<Record<RequestFate, readonly RequestActionId[]>> = {
  waiting: ['approve', 'change', 'not-now'],
  planned: ['open-roadmap', 'take-off'],
  building: ['open-roadmap'],
  built: ['try', 'not-right', 'fold']
}

/** The buttons a fate gives the reviewer; none for the fates that need nothing from the reviewer. */
export function actionsForFate(fate: RequestFate | undefined): RequestAction[] {
  return (fate ? (ACTIONS_BY_FATE[fate] ?? []) : []).map((id, index) => ({
    ...ACTIONS[id],
    primary: index === 0
  }))
}

/** The sentence under the buttons: what leaving it alone means. */
export function nothingNeeded(fate: RequestFate | undefined, answered: boolean): string {
  if (answered) return 'You have answered. The agent reads it next and updates the plan.'
  switch (fate) {
    case 'waiting':
      return 'Waiting on you: it needs your pick before it can go ahead.'
    case 'planned':
      return 'Nothing needed from you. Drag it to another release on the Roadmap if it should wait.'
    case 'built':
      return 'It exists. Try it once, or say it is wrong.'
    case 'building':
      return 'Nothing needed from you. It is being made now.'
    case 'merged':
    case 'declined':
      return 'Nothing needed from you. This one is closed.'
    default:
      return 'Nothing needed from you. The agent owes you a plan.'
  }
}
