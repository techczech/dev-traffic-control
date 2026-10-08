import { access, constants, mkdir, stat } from 'node:fs/promises'
import { ensureConfinedDir, readConfinedText, writeConfinedAtomic } from '../confinedFs'
import {
  CLAUDE_SIDECAR,
  PROJECT_AGENTS_MD,
  ROOT_AGENTS_MD,
  ROOT_TEMPLATE_VERSION,
  templateVersion
} from './templates'

/**
 * The files written here (`AGENTS.md`, `CLAUDE.md`, `.gitignore`) are named as
 * plain names below the records folder and go through the confined file calls
 * (confinedFs). A link at one of those names is never read through and never
 * written through: its target's text must not be copied into the records.
 */
async function writeIfAbsent(root: string, rel: string, data: string): Promise<void> {
  try {
    await writeConfinedAtomic(root, rel, data, { exclusive: true })
  } catch (error) {
    // Taken (a file, a folder or a link) — never clobber.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function hasRecognisedTemplateMarker(content: string): boolean {
  return /<!--\s*dev-traffic-control template v\d+\b[^>]*-->/.test(content)
}

const WATCH_SENTINEL_IGNORE = '.dtc-watch-ready-*.state.json'
const WATCH_CLAIM_IGNORE = '*.watch.json'
const MAINTAINED_IGNORES = [WATCH_SENTINEL_IGNORE, WATCH_CLAIM_IGNORE] as const
let gitignoreMaintenance: Promise<void> = Promise.resolve()

async function maintainGitignore(root: string): Promise<void> {
  let existing = ''
  try {
    existing = await readConfinedText(root, '.gitignore')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const lines = existing.split(/\r?\n/)
  if (MAINTAINED_IGNORES.every((pattern) => lines.includes(pattern))) return
  const crlfCount = existing.match(/\r\n/g)?.length ?? 0
  const lfCount = existing.match(/(?<!\r)\n/g)?.length ?? 0
  const lineEnding = crlfCount > lfCount ? '\r\n' : '\n'
  const separator = existing.length > 0 && !existing.endsWith('\n') ? lineEnding : ''
  const missing = MAINTAINED_IGNORES.filter((pattern) => !lines.includes(pattern))
  await writeConfinedAtomic(
    root,
    '.gitignore',
    `${existing}${separator}${missing.join(lineEnding)}${lineEnding}`
  )
}

function serialiseGitignoreMaintenance(root: string): Promise<void> {
  const maintenance = gitignoreMaintenance
    .catch(() => undefined)
    .then(() => maintainGitignore(root))
  gitignoreMaintenance = maintenance.catch(() => undefined)
  return maintenance
}

async function tolerateMaintenance(label: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation()
  } catch (error) {
    console.error(`Record ${label} maintenance failed; continuing`, error)
  }
}

// Only a marked template is app-owned. Unmarked files belong to their author,
// regardless of the root name or the version templateVersion assigns them.
async function writeIfOutdated(
  root: string,
  rel: string,
  data: string,
  version: number
): Promise<void> {
  try {
    const existing = await readConfinedText(root, rel)
    if (!hasRecognisedTemplateMarker(existing) || templateVersion(existing) >= version) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return
  }
  await writeConfinedAtomic(root, rel, data)
}

export async function ensureQaRepo(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  if (!(await stat(root)).isDirectory()) throw new Error(`Record root is not a directory: ${root}`)
  await access(root, constants.R_OK | constants.X_OK)
  await tolerateMaintenance('contract', () =>
    writeIfOutdated(root, 'AGENTS.md', ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION)
  )
  await tolerateMaintenance('Claude sidecar', () =>
    writeIfAbsent(root, 'CLAUDE.md', CLAUDE_SIDECAR)
  )
  await tolerateMaintenance('sentinel ignore', () => serialiseGitignoreMaintenance(root))
}

/**
 * Launch-time contract refresh: update the live root AGENTS.md when this build
 * bundles a newer template. Deliberately NOT {@link ensureQaRepo} — a missing
 * root must stay honestly missing (the rootMissing UI), never be resurrected
 * as an empty folder by a refresh.
 */
export async function refreshContract(root: string): Promise<void> {
  try {
    if (!(await stat(root)).isDirectory()) return
  } catch {
    return
  }
  await tolerateMaintenance('contract', () =>
    writeIfOutdated(root, 'AGENTS.md', ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION)
  )
  await tolerateMaintenance('sentinel ignore', () => serialiseGitignoreMaintenance(root))
}

export async function ensureProject(root: string, slug: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await ensureConfinedDir(root, slug)
  await writeIfAbsent(root, `${slug}/AGENTS.md`, PROJECT_AGENTS_MD(slug))
  await writeIfAbsent(root, `${slug}/CLAUDE.md`, CLAUDE_SIDECAR)
}
