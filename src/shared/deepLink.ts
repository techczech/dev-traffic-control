/**
 * The `dtc://` link grammar (ADR-0016 § 5, `mechanism.md` § 1).
 *
 * Three verbs and no more:
 *
 * ```
 * dtc://open/<project>/<record path within the project>[#fragment]
 * dtc://project/<project>
 * dtc://thread/<project>/<thread id>
 * ```
 *
 * The path IS the address, so an agent builds a link from the file it has just
 * written with no lookup and no id resolution. Percent-encoding is accepted but
 * never required.
 *
 * **This parser is a security boundary.** Any web page can fire a custom-scheme
 * URL, so every string reaching it is attacker-controllable. It is therefore
 * written against the RAW text rather than `new URL()`: the WHATWG path state
 * machine silently collapses `..` segments, and a link that escapes the record
 * root must be REFUSED, never quietly clamped to something inside it
 * (ADR-0016 § Security). Nothing here touches the filesystem — confinement is a
 * separate gate in main, and both run before any renderer sees a path.
 */

export const DEEP_LINK_SCHEME = 'dtc'
const SCHEME_PREFIX = `${DEEP_LINK_SCHEME}://`

export const DEEP_LINK_VERBS = ['open', 'project', 'thread'] as const
export type DeepLinkVerb = (typeof DEEP_LINK_VERBS)[number]

export type DeepLink =
  | { verb: 'open'; project: string; path: string; fragment?: string }
  | { verb: 'project'; project: string }
  | { verb: 'thread'; project: string; thread: string }

/**
 * A slug: a project folder, a thread id or a fragment. Deliberately tighter
 * than a path segment — these are names the app itself mints, and a wider rule
 * here buys nothing and costs review confidence.
 */
const SLUG = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

/**
 * A path segment inside a project. Wider than a slug because record filenames
 * are dated slugs the estate's own tools produce, but every traversal and
 * separator character is out: `/`, `\`, `:`, control characters and NUL.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_SEGMENT = /[/\\:\u0000-\u001F\u007F]/

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    // Malformed percent-encoding. Refused rather than passed through raw: a
    // string the app and the filesystem would read differently is exactly the
    // shape a confinement bypass takes.
    return null
  }
}

function validSegment(segment: string): boolean {
  if (segment.length === 0) return false
  if (segment === '.' || segment === '..') return false
  return !FORBIDDEN_IN_SEGMENT.test(segment)
}

/** Decode every segment, then validate. Decoding first is what refuses `%2e%2e`. */
function decodeSegments(segments: readonly string[]): string[] | null {
  const decoded: string[] = []
  for (const segment of segments) {
    const value = decodeSegment(segment)
    if (value === null || !validSegment(value)) return null
    decoded.push(value)
  }
  return decoded
}

/** Is this string addressed to the app at all? Verb and path are not judged. */
export function isDeepLinkUrl(raw: string): boolean {
  return (
    typeof raw === 'string' && raw.slice(0, SCHEME_PREFIX.length).toLowerCase() === SCHEME_PREFIX
  )
}

/**
 * The grammar, as a total function: a link the app will act on, or `null`.
 *
 * `null` is a refusal and is never recoverable by trimming or re-encoding the
 * input — a caller that "fixes" a rejected link has reintroduced the clamp this
 * function exists to prevent.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  if (!isDeepLinkUrl(raw)) return null

  const afterScheme = raw.slice(SCHEME_PREFIX.length)
  // A query string has no meaning in this grammar; treating `?` as a terminator
  // would silently discard whatever followed it, so it stays inside the segment
  // and is refused there.
  const hashAt = afterScheme.indexOf('#')
  const body = hashAt < 0 ? afterScheme : afterScheme.slice(0, hashAt)
  const rawFragment = hashAt < 0 ? null : afterScheme.slice(hashAt + 1)

  const [rawVerb, ...rawSegments] = body.split('/')
  const verb = decodeSegment(rawVerb ?? '')?.toLowerCase() ?? ''
  if (!(DEEP_LINK_VERBS as readonly string[]).includes(verb)) return null

  const segments = decodeSegments(rawSegments)
  if (!segments || segments.length === 0) return null

  const [project, ...rest] = segments
  if (!SLUG.test(project)) return null

  let fragment: string | undefined
  if (rawFragment !== null) {
    const decoded = decodeSegment(rawFragment)
    if (decoded === null || !SLUG.test(decoded)) return null
    fragment = decoded
  }

  if (verb === 'project') {
    // `project` enters a scope and opens nothing; trailing segments would mean
    // the sender thought it addressed something.
    return rest.length === 0 && fragment === undefined ? { verb: 'project', project } : null
  }

  if (verb === 'thread') {
    if (rest.length !== 1 || fragment !== undefined) return null
    return SLUG.test(rest[0]) ? { verb: 'thread', project, thread: rest[0] } : null
  }

  if (rest.length === 0) return null
  return {
    verb: 'open',
    project,
    path: rest.join('/'),
    ...(fragment === undefined ? {} : { fragment })
  }
}

/** The record-root-relative path a link addresses, including the project folder. */
export function recordRelativePath(link: DeepLink & { verb: 'open' }): string {
  return `${link.project}/${link.path}`
}

/**
 * The link to a project, as the scope indicator's *Copy link to this project*
 * writes it. The one place the app mints a link rather than reading one; it
 * produces exactly what `parseDeepLink` accepts back as `project`.
 */
export function projectLink(project: string): string {
  return `${SCHEME_PREFIX}project/${encodeURIComponent(project)}`
}

/**
 * A `dtc://` URL passed on a command line, as Windows and a directly-launched
 * binary deliver one. macOS uses `open-url` instead; both routes end in the
 * same handler so neither can rot (mechanism.md § 2).
 */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  return argv.find((argument) => isDeepLinkUrl(argument)) ?? null
}

// ---------------------------------------------------------------------------
// What main hands a renderer once a link has been through both gates.
// ---------------------------------------------------------------------------

/** The view a window opened by a link is born showing. */
export type DeepLinkView =
  | { kind: 'runner'; path: string }
  | { kind: 'note'; path: string }
  | { kind: 'thread'; project: string; thread: string }
  | { kind: 'project'; slug: string }
  /** A release record, optionally at one feature (`#feature-id`). */
  | { kind: 'release'; version: string; feature?: string }
  /** A roadmap idea file. */
  | { kind: 'roadmap'; idea: string }
  /** A handoff document. */
  | { kind: 'handoff'; path: string }

/**
 * The three arrival states the design draws (mockup states 19–22).
 *
 * `behind` and `refused` are held deliberately apart: a path that confines
 * cleanly but is not on this Mac is rootsync being behind and says so, with a
 * retry; a path that fails to confine is refused, shows no path and offers only
 * a way out. If sync lag ever wore the refusal's appearance, the refusal would
 * stop meaning anything.
 */
export type DeepLinkLanding =
  | {
      kind: 'opened'
      url: string
      project: string
      view: DeepLinkView
      fragment?: string
      coldLaunch: boolean
    }
  | {
      kind: 'behind'
      url: string
      project: string
      lastPulledAt?: string
      coldLaunch: boolean
    }
  | { kind: 'refused'; coldLaunch: boolean }

/** What a retry from the sync-lag state comes back with. */
export interface DeepLinkRetryResult {
  landing: DeepLinkLanding
  /** Set when the pull itself could not happen; said in human words. */
  pullFailed?: string
}
