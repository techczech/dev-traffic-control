import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import { salvageFrontmatter } from './parseRequest'
import { slugify } from './slug'
import type { Author, Form, Move, Outcome, ThreadEntry } from './types'

const MOVES = new Set<Move>(['me', 'agent', 'nobody'])
const FORMS = new Set<Form>(['idea', 'branch', 'sidequest', 'graft', 'strut'])
const OUTCOMES = new Set<Outcome>(['fused', 'delivered', 'abandoned'])

// Frontmatter keys the entry model owns; everything else falls to `labels`.
const KNOWN = new Set([
  'thread',
  'by',
  'written_by',
  'at',
  'title',
  'projects',
  'parents',
  'move',
  'form',
  'state',
  'outcome',
  'order',
  'dictation'
])

/**
 * Parse one thread entry (ADR-0009). Never throws and never drops content: a
 * garbled frontmatter block is salvaged (not abandoned), and a file with no
 * `thread:` still belongs to a thread derived from its name. `fallbackAt` is
 * the caller's mtime ISO — kept as a parameter so this stays pure.
 */
export function parseEntry(raw: string, filePath: string, fallbackAt: string): ThreadEntry {
  const basename = path.basename(filePath, '.md')
  const entry: ThreadEntry = {
    path: filePath,
    thread: threadFromBasename(basename),
    by: 'agent',
    writtenBy: 'agent',
    at: fallbackAt,
    projects: [],
    parents: [],
    dictation: false,
    body: raw,
    labels: {}
  }

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!fm) return entry

  let meta: Record<string, unknown>
  try {
    const parsed: unknown = parseYaml(fm[1]) ?? {}
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a map')
    meta = parsed as Record<string, unknown>
  } catch {
    meta = salvageFrontmatter(fm[1])
    entry.fmSalvaged = true
  }

  entry.body = raw.slice(fm[0].length)

  if (typeof meta.thread === 'string' && meta.thread.trim()) entry.thread = meta.thread.trim()
  entry.by = author(meta.by, 'agent')
  entry.writtenBy = author(meta.written_by, entry.by)
  entry.projects = list(meta.projects)
  entry.parents = list(meta.parents)
  entry.dictation = truthy(meta.dictation)

  if (typeof meta.title === 'string' && meta.title.trim()) entry.title = meta.title.trim()
  const at = isoOf(meta.at) ?? atFromBasename(basename)
  if (at) entry.at = at

  if (typeof meta.move === 'string' && MOVES.has(meta.move as Move)) entry.move = meta.move as Move
  if (typeof meta.form === 'string' && FORMS.has(meta.form as Form)) entry.form = meta.form as Form
  if (meta.state === 'open' || meta.state === 'retired') entry.state = meta.state
  if (typeof meta.outcome === 'string' && OUTCOMES.has(meta.outcome as Outcome))
    entry.outcome = meta.outcome as Outcome

  const order = parseOrder(meta.order, meta.project, entry.projects)
  if (order) entry.order = order

  for (const [k, v] of Object.entries(meta)) {
    if (KNOWN.has(k) || k === 'project') continue
    entry.labels[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }

  return entry
}

/** Is this file a thread entry? Filename marker OR a `thread:` frontmatter key. */
export function isEntry(name: string, raw: string): boolean {
  if (/-entry-/.test(name)) return true
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return !!fm && /^\s*thread\s*:/m.test(fm[1])
}

function author(v: unknown, fallback: Author): Author {
  return v === 'dominik' || v === 'reviewer' || v === 'agent' ? v : fallback
}

// A YAML list, or a comma-separated string, trimmed with empties dropped.
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

function truthy(v: unknown): boolean {
  return v === true || v === 'true' || v === 'yes'
}

function isoOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  return v.trim()
}

/** Order assertion: `order: [a,b]` (+ sibling `project:`), or `{project, threads}`. */
function parseOrder(
  order: unknown,
  siblingProject: unknown,
  projects: string[]
): { project: string; threads: string[] } | null {
  if (Array.isArray(order)) {
    const threads = order.map((x) => String(x).trim()).filter(Boolean)
    const project =
      typeof siblingProject === 'string' && siblingProject.trim()
        ? siblingProject.trim()
        : (projects[0] ?? null)
    return project ? { project, threads } : null
  }
  if (order && typeof order === 'object' && !Array.isArray(order)) {
    const o = order as Record<string, unknown>
    const project =
      typeof o.project === 'string' && o.project.trim() ? o.project.trim() : (projects[0] ?? null)
    const threads = Array.isArray(o.threads)
      ? o.threads.map((x) => String(x).trim()).filter(Boolean)
      : []
    return project ? { project, threads } : null
  }
  return null
}

/** Thread id from a filename: strip a leading date/time and an `-entry-` marker. */
function threadFromBasename(basename: string): string {
  const stripped = basename
    .replace(/^\d{4}-\d{2}-\d{2}(-\d{4})?-/, '')
    .replace(/^entry-/, '')
    .replace(/-entry-/, '-')
  return slugify(stripped || basename)
}

/** ISO from a `YYYY-MM-DD[-HHMM]` filename prefix, else null. */
function atFromBasename(basename: string): string | null {
  const m = basename.match(/^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?/)
  if (!m) return null
  const [, y, mo, d, hh, mm] = m
  return `${y}-${mo}-${d}T${hh ?? '00'}:${mm ?? '00'}:00.000Z`
}
