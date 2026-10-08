import type { QaSnapshot } from '../../../shared/ipc'
import { parseDeepLink, recordRelativePath } from '../../../shared/deepLink'
import { requestIdentity } from '../../../shared/requestIdentity'
import { formatDenseDay } from './dateVocabulary'
import { isHandoffReady, isRequestOwed, type Housekeeping } from './projectStanding'
import { fateLabel, isRequestIdeaOwed } from './requestFate'
import { isFeatureRequest } from '../../../main/qa/featureRequest'
import { runTitle, waitingForRun } from './waitingRows'
import { runAgeSource } from './format'

/**
 * Records named in a thread. An entry body that names a record —
 * a `dtc://open/...` link or a bare file name that exists in the project —
 * shows it as a chip: its title, where it stands, and a way in. A name that
 * matches no record in the project stays the text it was.
 */

export type ChipTarget =
  | { kind: 'runner'; path: string }
  | { kind: 'thread'; project: string; thread: string }
  | { kind: 'note'; path: string }
  | { kind: 'handoffs'; path: string }
  | { kind: 'releases'; version: string }
  | { kind: 'roadmap'; idea: string }
  | { kind: 'requests'; project: string; idea: string }

export interface RecordChip {
  /** Unique per record, so two mentions of one record share a key. */
  key: string
  title: string
  /** "Answered 29 Sep", "Waiting on you · 4 decisions, 0 decided". */
  state: string
  /** `wait` is amber, `done` green, `quiet` neutral. */
  tone: 'wait' | 'done' | 'quiet'
  target: ChipTarget
}

export type BodyPart = { kind: 'text'; text: string } | { kind: 'chip'; chip: RecordChip }

export interface RecordIndex {
  byRelative: ReadonlyMap<string, RecordChip>
  byBasename: ReadonlyMap<string, RecordChip>
  byThread: ReadonlyMap<string, RecordChip>
}

const EMPTY_INDEX: RecordIndex = {
  byRelative: new Map(),
  byBasename: new Map(),
  byThread: new Map()
}

function baseOf(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').replace(/\.md$/i, '').toLowerCase()
}

/** The records of `projects`, each as the chip that would name it. */
export function recordIndex(
  snapshot: QaSnapshot | null,
  projects: readonly string[],
  now: Date,
  housekeeping?: Housekeeping
): RecordIndex {
  if (!snapshot) return EMPTY_INDEX
  const inScope = (project: string): boolean => projects.includes(project)
  const byRelative = new Map<string, RecordChip>()
  const byBasename = new Map<string, RecordChip>()
  const byThread = new Map<string, RecordChip>()
  const add = (relative: string, basename: string, chip: RecordChip): void => {
    byRelative.set(relative.replace(/\.md$/i, '').toLowerCase(), chip)
    if (!byBasename.has(basename)) byBasename.set(basename, chip)
  }

  for (const run of snapshot.runs) {
    if (!inScope(run.project)) continue
    const finished = run.status === 'done' || !!run.resolvedAt
    const owed = isRequestOwed(run, housekeeping)
    let state: string
    let tone: RecordChip['tone']
    if (finished) {
      const when = run.report?.completedAt || run.resolvedAt || ''
      state = when ? `Answered ${formatDenseDay(when, now)}` : 'Answered'
      tone = 'done'
    } else if (owed) {
      const meta = waitingForRun(run, runAgeSource(run), now)
      state = `Waiting on you · ${meta.lead}${meta.rest.replace(' · ', ', ')}`
      tone = 'wait'
    } else {
      state = 'Archived'
      tone = 'quiet'
    }
    add(requestIdentity(snapshot.root, run.request.path), baseOf(run.request.path), {
      key: `run:${run.request.path}`,
      title: runTitle(run),
      state,
      tone,
      target: { kind: 'runner', path: run.request.path }
    })
  }

  for (const handoff of snapshot.handoffs) {
    if (!inScope(handoff.project)) continue
    const ready = isHandoffReady(handoff)
    const state = ready
      ? 'Waiting on you · never picked up'
      : handoff.state === 'done'
        ? 'Done'
        : handoff.state === 'superseded'
          ? 'Superseded'
          : 'Picked up'
    add(requestIdentity(snapshot.root, handoff.path), baseOf(handoff.path), {
      key: `handoff:${handoff.path}`,
      title: handoff.title,
      state,
      tone: ready ? 'wait' : 'quiet',
      target: { kind: 'handoffs', path: handoff.path }
    })
  }

  for (const note of snapshot.notes) {
    if (!inScope(note.project)) continue
    add(requestIdentity(snapshot.root, note.path), baseOf(note.path), {
      key: `note:${note.path}`,
      title: note.title,
      state: note.status === 'draft' ? 'Note · draft' : 'Note',
      tone: 'quiet',
      target: { kind: 'note', path: note.path }
    })
  }

  for (const release of snapshot.releases) {
    if (release.kind !== 'recorded' || !inScope(release.project)) continue
    for (const candidate of release.versions) {
      add(`${release.project}/releases/${candidate.version}`, `release-${candidate.version}`, {
        key: `release:${release.project}:${candidate.version}`,
        title: `Release ${candidate.version}`,
        state: candidate.shipment ? 'Shipped' : 'In flight',
        tone: 'quiet',
        target: { kind: 'releases', version: candidate.version }
      })
    }
  }

  // Roadmap ideas, so a request's `related` can name another idea.
  for (const pool of snapshot.pools ?? []) {
    if (!inScope(pool.project)) continue
    for (const idea of pool.ideas) {
      const request = isFeatureRequest(idea.request)
      const state = request
        ? isRequestIdeaOwed(idea)
          ? 'Waiting on you · needs your pick'
          : fateLabel(idea)
        : idea.state === 'promoted'
          ? `Promoted${idea.candidateRelease ? ` to ${idea.candidateRelease}` : ''}`
          : idea.state === 'setaside'
            ? 'Set aside'
            : 'Idea in the pool'
      add(`${pool.project}/roadmap/${idea.id}`, idea.id.toLowerCase(), {
        key: `idea:${pool.project}/${idea.id}`,
        title: idea.title,
        state,
        tone: request
          ? isRequestIdeaOwed(idea)
            ? 'wait'
            : idea.request?.fate === 'built' || idea.request?.fate === 'merged'
              ? 'done'
              : 'quiet'
          : 'quiet',
        target: request
          ? { kind: 'requests', project: pool.project, idea: idea.id }
          : { kind: 'roadmap', idea: idea.id }
      })
    }
  }

  for (const thread of snapshot.threads) {
    byThread.set(thread.id, {
      key: `thread:${thread.id}`,
      title: thread.title,
      state:
        thread.state === 'retired'
          ? 'Closed'
          : thread.move === 'me'
            ? 'Waiting on you'
            : thread.move === 'agent'
              ? 'With your agents'
              : 'Open',
      tone: thread.state !== 'retired' && thread.move === 'me' ? 'wait' : 'quiet',
      target: {
        kind: 'thread',
        project: thread.projects[0] ?? projects[0] ?? '',
        thread: thread.id
      }
    })
  }

  return { byRelative, byBasename, byThread }
}

function chipForLink(url: string, index: RecordIndex): RecordChip | null {
  const link = parseDeepLink(url)
  if (!link) return null
  if (link.verb === 'thread') return index.byThread.get(link.thread) ?? null
  if (link.verb !== 'open') return null
  return index.byRelative.get(recordRelativePath(link).replace(/\.md$/i, '').toLowerCase()) ?? null
}

function chipForBasename(token: string, index: RecordIndex): RecordChip | null {
  const trimmed = (token.split('/').pop() ?? token)
    .replace(/[._-]+$/, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
  return index.byBasename.get(trimmed) ?? null
}

// A markdown link, a bare dtc:// link, or a date-led file name. The markdown
// alternative comes first so a date inside some other link's address is not read
// as a record name.
const REFERENCE =
  /\[([^\]]*)\]\(([^)\s]*)\)|dtc:\/\/[^\s)\]>]*[^\s)\]>.,;:!?]|\b\d{4}-\d{2}-\d{2}[A-Za-z0-9._-]*/g

/**
 * An entry body as text and chips, in reading order. A link whose label is
 * given (`[label](dtc://...)`) is replaced whole by its chip; the chip carries
 * the record's own title, so the label is not repeated.
 */
export function bodyParts(body: string, index: RecordIndex): BodyPart[] {
  const parts: BodyPart[] = []
  let last = 0
  const pushText = (text: string): void => {
    if (!text) return
    const previous = parts[parts.length - 1]
    if (previous?.kind === 'text') previous.text += text
    else parts.push({ kind: 'text', text })
  }
  for (const match of body.matchAll(REFERENCE)) {
    const at = match.index ?? 0
    const token = match[0]
    let chip: RecordChip | null = null
    if (match[2] !== undefined) chip = chipForLink(match[2], index)
    else if (token.toLowerCase().startsWith('dtc://')) chip = chipForLink(token, index)
    else chip = chipForBasename(token, index)
    if (!chip) continue
    pushText(body.slice(last, at))
    parts.push({ kind: 'chip', chip })
    // A file name's trailing separators belong to the sentence, not the name.
    const consumed =
      match[2] === undefined && !token.toLowerCase().startsWith('dtc://')
        ? token.replace(/[._-]+$/, '')
        : token
    last = at + consumed.length
  }
  pushText(body.slice(last))
  return unwrapParentheses(parts)
}

/**
 * "(review 2026-01-29-plan)" reads as "(review [chip])" once the name is a
 * chip. When the chip closes its own brackets, the brackets are dropped.
 */
function unwrapParentheses(parts: BodyPart[]): BodyPart[] {
  const out = parts.map((part) => ({ ...part }) as BodyPart)
  out.forEach((part, at) => {
    if (part.kind !== 'chip') return
    const before = out[at - 1]
    const after = out[at + 1]
    if (before?.kind !== 'text' || after?.kind !== 'text') return
    if (!/\([^()]*$/.test(before.text) || !/^\)/.test(after.text)) return
    before.text = before.text.replace(/\(([^()]*)$/, '$1')
    after.text = after.text.slice(1)
  })
  return out.filter((part) => part.kind === 'chip' || part.text !== '')
}

/** A thread's `parents`, each as a chip when it names a record, else its plain name. */
export function parentChips(
  parents: readonly string[],
  index: RecordIndex
): Array<{ name: string; chip: RecordChip | null }> {
  return parents.map((name) => {
    const chip = index.byThread.get(name) ?? chipForBasename(name, index) ?? null
    return { name, chip }
  })
}

/**
 * A request's `related` entries, each as a chip when it names a record: a
 * `dtc://` link, a request's file name, `release-<version>`, an idea's id or a
 * thread id. A name that matches nothing stays its plain text (`chip: null`).
 */
export function relatedChips(
  related: readonly string[],
  index: RecordIndex
): Array<{ name: string; chip: RecordChip | null }> {
  return related.map((name) => {
    const chip = name.toLowerCase().startsWith('dtc://')
      ? chipForLink(name, index)
      : (chipForBasename(name, index) ?? index.byThread.get(name) ?? null)
    return { name, chip }
  })
}
