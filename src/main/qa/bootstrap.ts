import { access, constants, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './atomicWrite'
import {
  CLAUDE_SIDECAR,
  PROJECT_AGENTS_MD,
  ROOT_AGENTS_MD,
  ROOT_TEMPLATE_VERSION,
  templateVersion
} from './templates'

async function writeIfAbsent(p: string, data: string): Promise<void> {
  try {
    await stat(p)
    return // exists — never clobber
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return
  }
  await atomicWrite(p, data)
}

function hasRecognisedTemplateMarker(content: string): boolean {
  return /<!--\s*dev-traffic-control template v\d+\b[^>]*-->/.test(content)
}

const WATCH_SENTINEL_IGNORE = '.dtc-watch-ready-*.state.json'
const WATCH_CLAIM_IGNORE = '*.watch.json'
const MAINTAINED_IGNORES = [WATCH_SENTINEL_IGNORE, WATCH_CLAIM_IGNORE] as const
let gitignoreMaintenance: Promise<void> = Promise.resolve()

async function maintainGitignore(root: string): Promise<void> {
  const ignorePath = path.join(root, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(ignorePath, 'utf8')
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
  await atomicWrite(ignorePath, `${existing}${separator}${missing.join(lineEnding)}${lineEnding}`)
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
async function writeIfOutdated(p: string, data: string, version: number): Promise<void> {
  try {
    const existing = await readFile(p, 'utf8')
    if (!hasRecognisedTemplateMarker(existing) || templateVersion(existing) >= version) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return
  }
  await atomicWrite(p, data)
}

export async function ensureQaRepo(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  if (!(await stat(root)).isDirectory()) throw new Error(`Record root is not a directory: ${root}`)
  await access(root, constants.R_OK | constants.X_OK)
  const contractPath = path.join(root, 'AGENTS.md')
  await tolerateMaintenance('contract', () =>
    writeIfOutdated(contractPath, ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION)
  )
  await tolerateMaintenance('Claude sidecar', () =>
    writeIfAbsent(path.join(root, 'CLAUDE.md'), CLAUDE_SIDECAR)
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
    writeIfOutdated(path.join(root, 'AGENTS.md'), ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION)
  )
  await tolerateMaintenance('sentinel ignore', () => serialiseGitignoreMaintenance(root))
}

export async function ensureProject(root: string, slug: string): Promise<void> {
  const dir = path.join(root, slug)
  await mkdir(dir, { recursive: true })
  await writeIfAbsent(path.join(dir, 'AGENTS.md'), PROJECT_AGENTS_MD(slug))
  await writeIfAbsent(path.join(dir, 'CLAUDE.md'), CLAUDE_SIDECAR)
}
