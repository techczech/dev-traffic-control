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
 * **One shorthand, and only one.** A link whose first segment is not a verb but
 * is a valid project slug is read exactly as `open/<that slug>/<rest>`:
 * `dtc://tallyboard/x.md` is `dtc://open/tallyboard/x.md`. Agents write it that
 * way often enough that refusing it turned real records away (ticket 40). It is
 * not a repair: the shorthand is part of the grammar, it applies only when
 * `<rest>` is non-empty, and every segment passes exactly the checks an explicit
 * `open` link does. A first segment that IS a verb always keeps the verb's
 * meaning, so a project called `thread` must be addressed as `open/thread/…`.
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
// Characters that are invisible, reorder text or end a line: C0, DEL, C1
// (incl. U+0085), Arabic letter mark, zero-width and bidi controls, line and
// paragraph separators, word joiner and invisible operators, BOM, and the
// interlinear annotation anchors. One class serves the segment check and the
// inert-text cleaner.
const UNSAFE_CHARS =
  '\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2069\\uFEFF\\uFFF9-\\uFFFB'
const FORBIDDEN_IN_SEGMENT = new RegExp(`[/\\\\:${UNSAFE_CHARS}]`)

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
 * function exists to prevent. The verb-less shorthand (module comment) lives
 * HERE, inside the grammar, for that reason: it is a spelling the grammar
 * accepts and runs through every check, not a second attempt at a refused link.
 * It never drops, trims, decodes twice or reorders a segment.
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

  const [rawVerb, ...afterVerb] = body.split('/')
  const named = decodeSegment(rawVerb ?? '')?.toLowerCase() ?? ''
  const isVerb = (DEEP_LINK_VERBS as readonly string[]).includes(named)
  // Verb-less shorthand: the first segment is the project, and the link is an
  // `open`. The project slug check, the segment checks and the non-empty rest
  // below are the same ones an explicit `open` link meets.
  const verb = isVerb ? (named as DeepLinkVerb) : 'open'
  const rawSegments = isVerb ? afterVerb : [rawVerb ?? '', ...afterVerb]

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
 * retry; a path that fails to confine is refused and offers only a way out. If
 * sync lag ever wore the refusal's appearance, the refusal would stop meaning
 * anything.
 *
 * A refusal carries the link as it arrived (ticket 40) so the page can show it
 * back as inert text for the reviewer to send to the agent that wrote it. It is
 * never parsed, resolved or linked from there — see `inertLinkText`.
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
  | { kind: 'refused'; url?: string; coldLaunch: boolean }

/** What a retry from the sync-lag state comes back with. */
export interface DeepLinkRetryResult {
  landing: DeepLinkLanding
  /** Set when the pull itself could not happen; said in human words. */
  pullFailed?: string
}

// ---------------------------------------------------------------------------
// Showing a refused link back, as text and nothing more.
// ---------------------------------------------------------------------------

/** How much of a refused link the refusal page shows. */
export const INERT_LINK_DISPLAY_LIMIT = 200
/** How much of it the Copy button copies; a hostile page can fire megabytes. */
export const INERT_LINK_COPY_LIMIT = 4096

/**
 * C0 and C1 controls, DEL, and every bidirectional or zero-width formatting
 * character: the ones that can make displayed text read differently from what
 * it is (a right-to-left override turning `dm.txe` into `exe.md`), plus
 * zero-width characters that hide inside an otherwise ordinary-looking link.
 */
const UNSAFE_TEXT = new RegExp(`[${UNSAFE_CHARS}]`, 'g')

/**
 * A refused link made safe to show as text: unsafe characters removed, then
 * cut to a length. `display` is truncated to about 200 characters with an
 * ellipsis; `copy` is the whole cleaned link, capped. Neither is ever decoded,
 * parsed or resolved — the refusal page shows what arrived, not what it meant.
 */
export function inertLinkText(raw: unknown): { display: string; copy: string } {
  // Slice first: cleaning and splitting a megabyte string is wasted work. 2x
  // leaves room for removed characters and surrogate pairs.
  const head = typeof raw === 'string' ? raw.slice(0, INERT_LINK_COPY_LIMIT * 2) : ''
  const cleaned = head.replace(UNSAFE_TEXT, '')
  // By code point, so a cut never leaves half a surrogate pair behind.
  const chars = Array.from(cleaned)
  const copy = chars.slice(0, INERT_LINK_COPY_LIMIT).join('')
  const display =
    chars.length > INERT_LINK_DISPLAY_LIMIT
      ? `${chars.slice(0, INERT_LINK_DISPLAY_LIMIT).join('')}…`
      : cleaned
  return { display, copy }
}
