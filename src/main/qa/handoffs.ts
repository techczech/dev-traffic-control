import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  ConfinementError,
  listConfined,
  readConfinedText,
  writeConfinedAtomic,
  type RecordTarget
} from '../confinedFs'
import { tildePath } from '../../shared/tildePath'

export type HandoffMove = 'agent' | 'me'
export type HandoffState = 'live' | 'superseded' | 'done'

export interface HandoffSidecar {
  pickedUpAt: string | null
  archivedAt: string | null
}

export type HandoffHistory =
  { kind: 'never-picked-up' } | { kind: 'picked-up'; at: string } | { kind: 'archived'; at: string }

export interface Handoff {
  path: string
  file: string
  title: string
  domain: string
  repo?: string
  project: string
  move?: HandoffMove
  state?: HandoffState
  updated: string
  resume?: string
  bodyMarkdown: string
  raw: string
  relaunchPrompt: string
  sidecar: HandoffSidecar
  history: HandoffHistory
  ageDays: number
  stale: boolean
  frontmatterMalformed: boolean
}

export interface HandoffScanResult {
  root: string
  rootMissing: boolean
  handoffs: Handoff[]
}

const SKIP_FILES = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md'])
const EMPTY_SIDECAR: HandoffSidecar = { pickedUpAt: null, archivedAt: null }

export async function scanHandoffs(
  root: string,
  now: Date = new Date()
): Promise<HandoffScanResult> {
  if (!(await isDirectory(root))) return { root, rootMissing: true, handoffs: [] }

  const handoffs: Handoff[] = []
  for (const project of await directories(root)) {
    const directory = path.join(root, project.name, 'handoffs')
    // A symlinked project folder is already skipped (it is not a directory
    // Dirent), and so are symlinked .md files; a `handoffs` folder that is a
    // link is refused by the confined listing and skipped the same way.
    for (const entry of await markdownFiles(root, `${project.name}/handoffs`)) {
      if (SKIP_FILES.has(entry.name)) continue
      try {
        handoffs.push(await readHandoffFile(path.join(directory, entry.name), now))
      } catch (error) {
        // A handoff removed or replaced while the scan ran is left out; the
        // other handoffs still list.
        console.warn(
          `Skipping handoff that changed during scan: ${entry.name}`,
          error instanceof Error ? error.message : error
        )
      }
    }
  }
  return { root, rootMissing: false, handoffs }
}

/**
 * A handoff always sits at `<records folder>/<project>/handoffs/<file>`, so
 * the records folder is read off its path and every handoff read and sidecar
 * write is confined to it (confinedFs) with no root passed around.
 */
function handoffTarget(handoffPath: string, file = path.basename(handoffPath)): RecordTarget {
  const handoffs = path.dirname(handoffPath)
  const project = path.dirname(handoffs)
  if (!path.isAbsolute(handoffPath) || path.basename(handoffs) !== 'handoffs') {
    throw new ConfinementError('invalid-path', 'not a handoff path')
  }
  return {
    root: path.dirname(project),
    rel: [path.basename(project), 'handoffs', file].join('/')
  }
}

export async function readHandoffFile(filePath: string, now: Date = new Date()): Promise<Handoff> {
  const target = handoffTarget(filePath)
  const [raw, fileStat, sidecar] = await Promise.all([
    readConfinedText(target.root, target.rel),
    stat(filePath),
    readHandoffSidecar(filePath)
  ])
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  let meta: Record<string, unknown> = {}
  let frontmatterMalformed = false

  if (frontmatter) {
    try {
      const parsed: unknown = parseYaml(frontmatter[1]) ?? {}
      if (!isRecord(parsed)) throw new Error('frontmatter is not a map')
      meta = parsed
    } catch {
      frontmatterMalformed = true
    }
  }

  const file = path.basename(filePath)
  // <root>/<project>/handoffs/<file>
  const recordRoot = path.dirname(path.dirname(path.dirname(filePath)))
  const project = path.basename(path.dirname(path.dirname(filePath)))
  const bodyMarkdown = frontmatter ? raw.slice(frontmatter[0].length) : raw
  const title = scalar(meta.title) ?? firstHeading(bodyMarkdown) ?? filenameTitle(file)
  const domain = scalar(meta.domain) ?? project
  const repo = scalar(meta.repo)
  const updated = validDate(scalar(meta.updated)) ?? fileStat.mtime.toISOString()
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(updated).getTime()) / 86_400_000)
  )

  return {
    path: filePath,
    file,
    title,
    domain,
    repo,
    project,
    move: oneOf(meta.move, ['agent', 'me']),
    state: oneOf(meta.state, ['live', 'superseded', 'done']),
    updated,
    resume: scalar(meta.resume),
    bodyMarkdown,
    raw,
    relaunchPrompt: buildRelaunchPrompt(title, project, file, recordRoot),
    sidecar,
    history: deriveHandoffHistory(sidecar),
    ageDays,
    stale: ageDays > 7,
    frontmatterMalformed
  }
}

export function buildRelaunchPrompt(
  title: string,
  project: string,
  file: string,
  recordRoot: string
): string {
  const handoffPath = path.join(tildePath(recordRoot, homedir()), project, 'handoffs', file)
  return `Continue the ${title} thread.\n\nRead ${handoffPath} and pick up from where it leaves off.`
}

export function handoffSidecarPathFor(handoffPath: string): string {
  return handoffPath.endsWith('.md')
    ? `${handoffPath.slice(0, -'.md'.length)}.state.json`
    : `${handoffPath}.state.json`
}

export async function readHandoffSidecar(handoffPath: string): Promise<HandoffSidecar> {
  try {
    const target = handoffTarget(handoffPath, path.basename(handoffSidecarPathFor(handoffPath)))
    const parsed: unknown = JSON.parse(await readConfinedText(target.root, target.rel))
    if (!isRecord(parsed)) return { ...EMPTY_SIDECAR }
    const pickedUpAt = nullableTimestamp(parsed.pickedUpAt)
    const archivedAt = nullableTimestamp(parsed.archivedAt)
    if (pickedUpAt === undefined || archivedAt === undefined) return { ...EMPTY_SIDECAR }
    return { pickedUpAt, archivedAt }
  } catch {
    return { ...EMPTY_SIDECAR }
  }
}

export async function markHandoffPickedUp(
  handoffPath: string,
  now: () => string = () => new Date().toISOString()
): Promise<HandoffSidecar> {
  const current = await readHandoffSidecar(handoffPath)
  return writeHandoffSidecar(handoffPath, { ...current, pickedUpAt: now() })
}

export async function archiveHandoff(
  handoffPath: string,
  now: () => string = () => new Date().toISOString()
): Promise<HandoffSidecar> {
  const current = await readHandoffSidecar(handoffPath)
  return writeHandoffSidecar(handoffPath, { ...current, archivedAt: now() })
}

/** Restore an archived handoff: the sidecar's `archivedAt` goes back to null. */
export async function unarchiveHandoff(handoffPath: string): Promise<HandoffSidecar> {
  const current = await readHandoffSidecar(handoffPath)
  if (!current.archivedAt) return current
  return writeHandoffSidecar(handoffPath, { ...current, archivedAt: null })
}

async function writeHandoffSidecar(
  handoffPath: string,
  sidecar: HandoffSidecar
): Promise<HandoffSidecar> {
  const target = handoffTarget(handoffPath, path.basename(handoffSidecarPathFor(handoffPath)))
  await writeConfinedAtomic(target.root, target.rel, `${JSON.stringify(sidecar, null, 2)}\n`)
  return sidecar
}

export function deriveHandoffHistory(sidecar: HandoffSidecar): HandoffHistory {
  if (sidecar.archivedAt) return { kind: 'archived', at: sidecar.archivedAt }
  if (sidecar.pickedUpAt) return { kind: 'picked-up', at: sidecar.pickedUpAt }
  return { kind: 'never-picked-up' }
}

async function directories(root: string): Promise<Dirent[]> {
  try {
    return (await readdir(root, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.')
    )
  } catch {
    return []
  }
}

async function markdownFiles(root: string, relDirectory: string): Promise<Dirent[]> {
  try {
    return (await listConfined(root, relDirectory)).filter(
      (entry) => entry.isFile() && entry.name.endsWith('.md')
    )
  } catch {
    return []
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory()
  } catch {
    return false
  }
}

function firstHeading(markdown: string): string | undefined {
  const heading = markdown.match(/^#\s+(.+?)\s*$/m)
  return heading?.[1].trim() || undefined
}

function filenameTitle(file: string): string {
  return file
    .replace(/\.md$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/-handoff$/, '')
}

function validDate(value: string | undefined): string | undefined {
  if (!value || Number.isNaN(new Date(value).getTime())) return undefined
  return value
}

function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return undefined
  return value
}

function scalar(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text || undefined
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const candidate = scalar(value)
  return candidate && allowed.includes(candidate as T) ? (candidate as T) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
