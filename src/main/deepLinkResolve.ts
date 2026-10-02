import { confineRecordPath, type ConfinedRecordPath } from './requestPath'
import {
  parseDeepLink,
  recordRelativePath,
  type DeepLinkLanding,
  type DeepLinkView
} from '../shared/deepLink'
import { requestIdentity } from '../shared/requestIdentity'
import type { QaSnapshot } from '../shared/ipc'
import { ALL_PROJECTS, type WindowScope } from '../shared/windowScope'

/**
 * Resolving a `dtc://` link happens in two stages, and the split is forced by
 * the cold-launch case (mechanism.md § 2).
 *
 * 1. **Arrival** — parse and confine. Needs the record root and the filesystem,
 *    nothing else, so it can run before the record watcher has ever scanned.
 *    Its answer decides the scope the new window is BORN with, which is why it
 *    cannot be deferred until a renderer asks.
 * 2. **Landing** — which view that window opens on. Needs the scanned records,
 *    and is a pure function of them, so bursts, misses and hostile input are
 *    tested without a filesystem or a window.
 *
 * Neither stage writes anything, and no verb can be made to: a link selects an
 * existing record, it never constructs one. The worst a hostile link achieves
 * is showing the reviewer a file he already owns inside his own record folder.
 */

const MARKDOWN = '.md'

export type DeepLinkArrival =
  | { kind: 'refused' }
  /** Confined cleanly, but this Mac does not have it yet — rootsync is behind. */
  | { kind: 'behind'; project: string; lastPulledAt?: string }
  | { kind: 'record'; project: string; relative: string; path: string; fragment?: string }
  | { kind: 'project'; project: string }
  | { kind: 'thread'; project: string; thread: string }

export interface ArrivalDependencies {
  recordRoot: string
  /** Injected so the confinement gate can be exercised without a real tree. */
  confine?: (recordRoot: string, relativePath: string) => Promise<ConfinedRecordPath>
  /** When the record folder last pulled, for the sync-lag state's wording. */
  lastPulledAt?: () => Promise<string | undefined>
}

async function behind(
  project: string,
  dependencies: ArrivalDependencies
): Promise<DeepLinkArrival> {
  const at = await dependencies.lastPulledAt?.().catch(() => undefined)
  return { kind: 'behind', project, ...(at ? { lastPulledAt: at } : {}) }
}

/**
 * Parse, then confine. Both gates run in main and both refuse rather than
 * repair: a link that escapes the record root is turned away, never clamped.
 */
export async function resolveDeepLinkArrival(
  url: string,
  dependencies: ArrivalDependencies
): Promise<DeepLinkArrival> {
  const link = parseDeepLink(url)
  if (!link) return { kind: 'refused' }

  const confine = dependencies.confine ?? confineRecordPath
  let relative = link.verb === 'open' ? recordRelativePath(link) : link.project
  let confined = await confine(dependencies.recordRoot, relative)
  if (confined.kind === 'refused') return { kind: 'refused' }
  if (!confined.exists && link.verb === 'open' && !relative.endsWith(MARKDOWN)) {
    // Agents often drop the `.md` (ticket 40). The one candidate tried is the
    // same path with `.md` appended, never another extension, and it goes
    // through the same confinement gate before anything is read: a `.md` that
    // is a symlink out of the root is refused, not opened and not reported as
    // sync lag. Only a candidate that confines AND exists replaces the path.
    const withMarkdown = `${relative}${MARKDOWN}`
    const candidate = await confine(dependencies.recordRoot, withMarkdown)
    if (candidate.kind === 'refused') return { kind: 'refused' }
    if (candidate.exists) {
      relative = withMarkdown
      confined = candidate
    }
  }
  if (!confined.exists) return behind(link.project, dependencies)

  if (link.verb === 'project') return { kind: 'project', project: link.project }
  // A thread is identified by a `thread:` id in frontmatter, not by a file, so
  // only the project folder can be confined here. Whether the thread itself has
  // arrived is a question for the scanned records, one stage later.
  if (link.verb === 'thread') {
    return { kind: 'thread', project: link.project, thread: link.thread }
  }
  return {
    kind: 'record',
    project: link.project,
    relative,
    path: confined.path,
    ...(link.fragment === undefined ? {} : { fragment: link.fragment })
  }
}

/**
 * The scope a window opened by this link is born with.
 *
 * A refusal lands in *All projects* and names no project: the link is the
 * problem, and a window that named the project it was turned away from would
 * be repeating what the link claimed (mockup state 22).
 */
export function scopeForArrival(arrival: DeepLinkArrival): WindowScope {
  return arrival.kind === 'refused' ? ALL_PROJECTS : { kind: 'project', slug: arrival.project }
}

/** The path inside the project folder: `tallyboard/releases/0.34.0.md` → `releases/0.34.0.md`. */
function recordWithinProject(relative: string, project: string): string {
  return relative.startsWith(`${project}/`) ? relative.slice(project.length + 1) : relative
}

/** The parts of a snapshot a landing decision needs, and nothing more. */
export interface LandingRecords {
  recordRoot: string
  runPaths: readonly string[]
  notePaths: readonly string[]
  threadIds: readonly string[]
  /** Handoff document paths, so a handoff link opens that handoff. */
  handoffPaths?: readonly string[]
  /** Thread entry paths with the thread each belongs to. */
  entries?: ReadonlyArray<{ path: string; thread: string }>
}

export function landingRecords(snapshot: QaSnapshot | null): LandingRecords {
  return {
    recordRoot: snapshot?.root ?? '',
    runPaths: snapshot?.runs.map((run) => run.request.path) ?? [],
    notePaths: snapshot?.notes.map((note) => note.path) ?? [],
    threadIds: snapshot?.threads.map((thread) => thread.id) ?? [],
    handoffPaths: snapshot?.handoffs.map((handoff) => handoff.path) ?? [],
    entries: snapshot?.entries.map((entry) => ({ path: entry.path, thread: entry.thread })) ?? []
  }
}

/**
 * Match by the app's own canonical identity for a record — the path relative to
 * the record root (`shared/requestIdentity`) — not by string equality with the
 * confined path. A record root reached through a symlink gives the scanner one
 * spelling and `realpath` another, and comparing those directly would report a
 * record that is present as still in flight.
 */
function authoritativePath(
  paths: readonly string[],
  recordRoot: string,
  relative: string
): string | null {
  return paths.find((candidate) => requestIdentity(recordRoot, candidate) === relative) ?? null
}

/**
 * Which view the window opens on, as a pure function of the arrival and the
 * records the app has scanned.
 *
 * The view always carries the SCANNED path, never the one the link supplied —
 * a link selects a record the app already holds, so nothing downstream ever
 * reads a path an attacker chose the spelling of.
 */
export function landingForArrival(
  arrival: DeepLinkArrival,
  url: string,
  coldLaunch: boolean,
  records: LandingRecords
): DeepLinkLanding {
  // The refused link travels as the string that arrived, for the refusal page to
  // show back as inert text. It is never parsed again past this point.
  if (arrival.kind === 'refused') return { kind: 'refused', url, coldLaunch }
  if (arrival.kind === 'behind') {
    return {
      kind: 'behind',
      url,
      project: arrival.project,
      ...(arrival.lastPulledAt ? { lastPulledAt: arrival.lastPulledAt } : {}),
      coldLaunch
    }
  }

  const opened = (view: DeepLinkView, fragment?: string): DeepLinkLanding => ({
    kind: 'opened',
    url,
    project: arrival.project,
    view,
    ...(fragment === undefined ? {} : { fragment }),
    coldLaunch
  })

  if (arrival.kind === 'project') return opened({ kind: 'project', slug: arrival.project })

  if (arrival.kind === 'thread') {
    return records.threadIds.includes(arrival.thread)
      ? opened({ kind: 'thread', project: arrival.project, thread: arrival.thread })
      : { kind: 'behind', url, project: arrival.project, coldLaunch }
  }

  const run = authoritativePath(records.runPaths, records.recordRoot, arrival.relative)
  if (run) return opened({ kind: 'runner', path: run }, arrival.fragment)
  const note = authoritativePath(records.notePaths, records.recordRoot, arrival.relative)
  if (note) return opened({ kind: 'note', path: note }, arrival.fragment)
  // Release records, roadmap ideas, handoffs and thread entries open on the
  // thing itself. Anything else confined in the project lands on the project.
  const within = recordWithinProject(arrival.relative, arrival.project)
  const release = within.match(/^releases\/([^/]+)\.md$/)
  if (release)
    return opened({
      kind: 'release',
      version: release[1],
      ...(arrival.fragment ? { feature: arrival.fragment } : {})
    })
  const idea = within.match(/^roadmap\/([^/]+)\.md$/)
  if (idea && idea[1] !== 'order') return opened({ kind: 'roadmap', idea: idea[1] })
  const handoff = authoritativePath(
    records.handoffPaths ?? [],
    records.recordRoot,
    arrival.relative
  )
  if (handoff) return opened({ kind: 'handoff', path: handoff })
  const entry = (records.entries ?? []).find(
    (candidate) => requestIdentity(records.recordRoot, candidate.path) === arrival.relative
  )
  if (entry && records.threadIds.includes(entry.thread))
    return opened({ kind: 'thread', project: arrival.project, thread: entry.thread })
  return opened({ kind: 'project', slug: arrival.project }, arrival.fragment)
}
