import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { atomicWrite } from './atomicWrite'
import { slugify, uniqueId } from './slug'
import type { PoolTier } from './pool'
import { REQUEST_FATES, type RequestFate } from './featureRequest'

export interface PoolIdeaFileChanges {
  title?: string
  tier?: PoolTier
  bodyMarkdown?: string
  /**
   * A reviewer entry appended to the body as it is on disk now, in the same
   * write as the frontmatter patch, so an entry an agent added since the
   * caller's last scan survives.
   */
  appendEntry?: string
  /** Ticket 42: the two request keys the reviewer's approval and release moves own. */
  fate?: RequestFate
  /** A release version, or `null` to remove the `candidate` line (Unscheduled). */
  candidate?: string | null
}

export const MAX_APPEND_ENTRY_LENGTH = 8 * 1024

const CANDIDATE_VERSION = /^\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?$/

export interface NewPoolIdeaFile {
  title: string
  tier: PoolTier
  bodyMarkdown: string
  addedAt: string
}

/**
 * Changes only the owned scalar lines or body range in an existing idea file.
 * Unknown frontmatter and every untouched byte remain exactly as written.
 */
export async function patchPoolIdeaFile(
  filePath: string,
  changes: PoolIdeaFileChanges
): Promise<void> {
  const raw = await readFile(filePath, 'utf8')
  const boundary = frontmatterBoundary(raw)
  let prefix = raw.slice(0, boundary)

  if (changes.title !== undefined) {
    prefix = replaceScalarLine(prefix, 'title', changes.title)
  }
  if (changes.tier !== undefined) {
    prefix = replaceScalarLine(prefix, 'tier', changes.tier)
  }

  if (changes.appendEntry !== undefined) {
    const entry: unknown = changes.appendEntry
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error('A reviewer entry must be non-empty text.')
    }
    if (entry.length > MAX_APPEND_ENTRY_LENGTH) throw new Error('That reviewer entry is too long.')
    if (/^---[ \t]*\r?$/m.test(entry)) {
      throw new Error('A reviewer entry cannot contain a line that is only ---.')
    }
  }

  if (changes.fate !== undefined) {
    const fate: unknown = changes.fate
    if (typeof fate !== 'string' || !(REQUEST_FATES as readonly string[]).includes(fate))
      throw new Error('That fate is not one the app knows.')
    prefix = setFrontmatterScalar(prefix, 'fate', changes.fate)
  }
  if (changes.candidate !== undefined) {
    const candidate: unknown = changes.candidate
    if (
      candidate !== null &&
      (typeof candidate !== 'string' || !CANDIDATE_VERSION.test(candidate))
    ) {
      throw new Error('A candidate release must be a version such as 0.37.0.')
    }
    prefix = setFrontmatterScalar(prefix, 'candidate', changes.candidate)
  }

  let body = changes.bodyMarkdown === undefined ? raw.slice(boundary) : changes.bodyMarkdown
  if (changes.appendEntry !== undefined) {
    const base = body.trimEnd()
    body = `${base ? `${base}\n\n` : ''}${changes.appendEntry.trim()}\n`
  }
  await atomicWrite(filePath, `${prefix}${body}`)
}

/** Creates one complete idea file without choosing or exposing its filename early. */
export async function createPoolIdeaFile(
  directory: string,
  idea: NewPoolIdeaFile
): Promise<{ id: string; path: string }> {
  await mkdir(directory, { recursive: true })
  const taken = new Set(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.basename(entry.name, '.md'))
  )
  const id = uniqueId(slugify(idea.title), taken)
  const filePath = path.join(directory, `${id}.md`)
  const added = new Date(idea.addedAt)
  if (Number.isNaN(added.getTime())) throw new Error('The idea date is invalid.')
  const content = [
    '---',
    `id: ${yamlScalar(id)}`,
    `title: ${yamlScalar(idea.title)}`,
    `tier: ${idea.tier}`,
    `added: ${added.toISOString().slice(0, 10)}`,
    '---',
    '',
    idea.bodyMarkdown
  ].join('\n')
  await atomicWrite(filePath, content)
  return { id, path: filePath }
}

function frontmatterBoundary(raw: string): number {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/)
  if (!match) throw new Error('The Roadmap idea file has no valid frontmatter boundary.')
  const boundary = match[0].length
  const separator = raw.slice(boundary).match(/^\r?\n/)
  return boundary + (separator?.[0].length ?? 0)
}

function replaceScalarLine(frontmatter: string, key: 'title' | 'tier', value: string): string {
  const line = new RegExp(`^(${key}[ \\t]*:[ \\t]*)([^\\r\\n]*)(\\r?)$`, 'm')
  if (!line.test(frontmatter)) {
    throw new Error(`The Roadmap idea file has no ${key} field.`)
  }
  const encoded = yamlScalar(value)
  return frontmatter.replace(line, (_whole, before: string, _old: string, carriage: string) => {
    return `${before}${encoded}${carriage}`
  })
}

/**
 * Sets, adds or (with `null`) removes one top-level scalar line in the
 * frontmatter, leaving every other byte as written.
 */
function setFrontmatterScalar(prefix: string, key: string, value: string | null): string {
  const close = prefix.match(/\r?\n(---)(?:\r?\n)?/)
  if (!close || close.index === undefined) {
    throw new Error('The Roadmap idea file has no valid frontmatter boundary.')
  }
  const head = prefix.slice(0, close.index)
  const lineBreak = close[0].startsWith('\r\n') ? '\r\n' : '\n'
  const tail = prefix.slice(close.index)
  const line = new RegExp(`(^|\\r?\\n)${key}[ \\t]*:[^\\r\\n]*`)
  if (line.test(head)) {
    assertSingleLineScalar(head, key)
    if (value === null) return head.replace(line, '') + tail
    return (
      head.replace(line, (_whole, lead: string) => `${lead}${key}: ${yamlScalar(value)}`) + tail
    )
  }
  if (value === null) return prefix
  return `${head}${lineBreak}${key}: ${yamlScalar(value)}${tail}`
}

/** Refuses a key written as a YAML block scalar or with indented continuation lines. */
function assertSingleLineScalar(head: string, key: string): void {
  const found = new RegExp(`(?:^|\\r?\\n)${key}[ \\t]*:([^\\r\\n]*)(\\r?\\n[ \\t]+\\S)?`).exec(head)
  if (!found) return
  const value = found[1].trim()
  if (/^[>|]/.test(value) || found[2] !== undefined) {
    throw new Error(`The ${key} field is written over several lines; edit it by hand.`)
  }
}

function yamlScalar(value: string): string {
  return stringifyYaml(value).trimEnd()
}
