/** Path and link logic for the records folder. Pure: no `$`, no I/O except the injected probe. */

import { hasTraversal, safeRef } from './guard'

export const RESERVED_DIRS = ['releases', 'roadmap', 'threads', 'handoffs', '_unfiled'] as const

export type RequestRef = {
  /** Project slug: the first folder under the records folder. */
  project: string
  /** Path within the project, ending `.md` (may include one round folder). */
  rel: string
}

const BASE_SUFFIXES = ['.report.json', '.collected.json', '.opened.json', '.resolved.md', '.watch.json', '.answers.json', '.md']
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/

export function trimSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export function basename(path: string): string {
  const p = trimSlashes(path)
  return p.slice(p.lastIndexOf('/') + 1)
}

/** Resolves `rel` against `base`, collapsing `.` and `..`. An absolute `rel` stands alone. */
export function resolvePath(base: string, rel: string): string {
  const parts = (rel.startsWith('/') ? rel : `${base}/${rel}`).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return trimSlashes(`${trimSlashes(home)}/${path.slice(2)}`)
  return path
}

/** The request or report path with its record suffix removed. */
export function baseOf(path: string): string {
  for (const suffix of BASE_SUFFIXES) if (path.endsWith(suffix)) return path.slice(0, -suffix.length)
  return path
}

/**
 * Is this path a request under the DTC root? An agent-written `.md` at
 * `<root>/<project>/[<round>/]<file>.md`, outside the reserved folders, named like a
 * request (dated; not a resolution marker, note, entry or handoff).
 */
export function classifyRequestPath(path: string, root: string): RequestRef | null {
  const base = trimSlashes(root)
  if (hasTraversal(path) || !path.startsWith(`${base}/`)) return null
  const segments = path.slice(base.length + 1).split('/')
  if (segments.length < 2 || segments.length > 3) return null
  const file = segments[segments.length - 1] ?? ''
  const folders = segments.slice(0, -1)
  for (const folder of folders) {
    if (folder === '' || folder.startsWith('.') || (RESERVED_DIRS as readonly string[]).includes(folder)) return null
    if (/\.(shots|images)$/.test(folder)) return null
  }
  if (!file.endsWith('.md') || file.endsWith('.resolved.md')) return null
  if (!DATE_PREFIX.test(file)) return null
  if (/-(note|entry)-/.test(file) || file.endsWith('-handoff.md')) return null
  return { project: folders[0] as string, rel: segments.slice(1).join('/') }
}

export function requestPathOf(root: string, ref: RequestRef): string {
  return `${trimSlashes(root)}/${ref.project}/${ref.rel}`
}

export function dtcUrl(ref: RequestRef): string {
  return `dtc://open/${ref.project}/${ref.rel}`
}

/** What a record is, read from where it sits in its project: a request, a roadmap idea or a release record. */
export type RecordKind = 'request' | 'idea' | 'release'

/** `roadmap/<id>.md` (never `order`) is an idea, `releases/<version>.md` a release record; anything else is read as a request. */
export function kindOfRel(rel: string): RecordKind {
  const parts = rel.split('/')
  if (parts.length === 2 && rel.endsWith('.md')) {
    if (parts[0] === 'roadmap' && parts[1] !== 'order.md') return 'idea'
    if (parts[0] === 'releases') return 'release'
  }
  return 'request'
}

/**
 * Is this path a record whose answer the inbox follows? A request (`classifyRequestPath`), a
 * roadmap idea `<root>/<project>/roadmap/<id>.md`, or a release record
 * `<root>/<project>/releases/<version>.md`. The idea and release forms must pass `safeRef`.
 */
export function classifyRecordPath(path: string, root: string): { ref: RequestRef; kind: RecordKind } | null {
  const request = classifyRequestPath(path, root)
  if (request !== null) return { ref: request, kind: 'request' }
  const base = trimSlashes(root)
  if (hasTraversal(path) || !path.startsWith(`${base}/`)) return null
  const segments = path.slice(base.length + 1).split('/')
  if (segments.length !== 3) return null
  const ref = safeRef({ project: segments[0] as string, rel: `${segments[1] as string}/${segments[2] as string}` })
  if (ref === null || (RESERVED_DIRS as readonly string[]).includes(ref.project)) return null
  const kind = kindOfRel(ref.rel)
  return kind === 'request' ? null : { ref, kind }
}

const LINK_VERBS = ['open', 'project', 'thread']

/**
 * A `dtc://` link (bare or inside a markdown link) to its parts, by the app's grammar:
 * `dtc://open/<project>/<path>`, or the verb-less shorthand `dtc://<project>/<path>`, read exactly
 * as the `open` form when the first segment is not a verb. `.md` is added when absent and a
 * `#fragment` is dropped. Null for the `project` and `thread` verbs, for a link with no path
 * after the project, for a query string (`?` has no meaning in the grammar), and unless the parts
 * pass `safeRef`: no `..`, no empty segment (so no absolute path), no percent-encoding, no
 * control or bidirectional characters, nothing outside `A-Z a-z 0-9 . _ -`. Stricter than the
 * app in one way only: the app decodes percent-encoding, this refuses it.
 */
export function parseDtcLink(text: string): RequestRef | null {
  const m = /dtc:\/\/([^\s)\]#?]+)(.?)/i.exec(text)
  if (m === null || m[2] === '?') return null
  const segments = (m[1] as string).split('/')
  const first = (segments[0] as string).toLowerCase()
  const isVerb = LINK_VERBS.includes(first)
  if (isVerb && first !== 'open') return null
  const [project, ...rest] = isVerb ? segments.slice(1) : segments
  if (project === undefined || rest.length === 0) return null
  const rel = rest.join('/')
  return safeRef({ project, rel: rel.endsWith('.md') ? rel : `${rel}.md` })
}

/**
 * The record a tool argument names: an absolute path (request, report, receipt, roadmap idea,
 * release record or its answers file) or a dtc:// link. Refused (null) when it spells traversal (`..`, `.`, NUL, a backslash, `%2e` and
 * the like), is not under the root by a trailing-separator prefix, or fails `safeRef`. Where the
 * file really lands is checked at read time (`confinedTo`).
 */
export function requestRefFromArg(arg: string, root: string): RequestRef | null {
  const text = arg.trim()
  if (hasTraversal(text)) return null
  // A bare link is the whole argument: no whitespace for the parser to stop at and drop the rest.
  if (/^dtc:/i.test(text)) return /\s/.test(text) ? null : parseDtcLink(text)
  const link = parseDtcLink(text)
  if (link !== null) return link
  if (!text.startsWith('/')) return null
  const base = trimSlashes(root)
  if (!text.startsWith(`${base}/`)) return null
  const segments = `${baseOf(text)}.md`.slice(base.length + 1).split('/')
  if (segments.length < 2 || segments.length > 3) return null
  return safeRef({ project: segments[0] as string, rel: segments.slice(1).join('/') })
}

/** Does `text` link to this request, with or without the `.md`? */
export function linksTo(text: string, ref: RequestRef): boolean {
  const name = `${ref.project}/${ref.rel.replace(/\.md$/, '')}`
  // The explicit form and the verb-less shorthand both address the record.
  for (const stem of [`dtc://open/${name}`, `dtc://${name}`]) {
    let from = 0
    for (;;) {
      const at = text.indexOf(stem, from)
      if (at < 0) break
      const next = text.slice(at + stem.length, at + stem.length + 1)
      // `.md`, `)`, `#`, space, end: the same record. A longer name (`-b`) is another one.
      if (next === '' || !/[A-Za-z0-9_-]/.test(next)) return true
      from = at + 1
    }
  }
  return false
}

export type GitProbe = {
  kind: (path: string) => Promise<'file' | 'dir' | null>
  read: (path: string) => Promise<string | null>
}

function repoNameFromCommonDir(common: string): string {
  return basename(common) === '.git' ? basename(dirname(common)) : basename(common).replace(/\.git$/, '')
}

/**
 * The project of a working directory: the main repository's folder name. A linked
 * worktree has a `.git` file; it names a git dir whose `commondir` leads to the main
 * repository's `.git`. Falls back to the folder name when no repository is found.
 */
export async function resolveProject(cwd: string, probe: GitProbe): Promise<string> {
  let dir = trimSlashes(cwd)
  for (let guard = 0; guard < 64; guard++) {
    const kind = await probe.kind(`${dir}/.git`)
    if (kind === 'dir') return basename(dir)
    if (kind === 'file') {
      const pointer = (await probe.read(`${dir}/.git`)) ?? ''
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(pointer)
      if (m === null) return basename(dir)
      const gitDir = resolvePath(dir, m[1] as string)
      const commondir = ((await probe.read(`${gitDir}/commondir`)) ?? '').trim()
      if (commondir !== '') return repoNameFromCommonDir(resolvePath(gitDir, commondir))
      const at = gitDir.indexOf('/.git/worktrees/')
      return at > 0 ? basename(gitDir.slice(0, at)) : basename(dir)
    }
    if (dir === '/' || dir === '') break
    dir = dirname(dir)
  }
  return basename(cwd)
}

export type Scope = { kind: 'hub' } | { kind: 'project'; project: string }

/**
 * A session working in the all-projects folder (`hubDir`, optional) sees every project; any other
 * sees its own. With no such folder configured, every session is scoped to its project.
 */
export function scopeOf(cwd: string, project: string, hubDir: string): Scope {
  const hub = trimSlashes(hubDir)
  if (hub === '') return { kind: 'project', project }
  const here = trimSlashes(cwd)
  if (here === hub || here.startsWith(`${hub}/`) || project === basename(hub)) return { kind: 'hub' }
  return { kind: 'project', project }
}
