import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { atomicWrite } from './atomicWrite'
import { slugify, uniqueId } from './slug'
import type { PoolTier } from './pool'

export interface PoolIdeaFileChanges {
  title?: string
  tier?: PoolTier
  bodyMarkdown?: string
}

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

  const body = changes.bodyMarkdown === undefined ? raw.slice(boundary) : changes.bodyMarkdown
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

function yamlScalar(value: string): string {
  return stringifyYaml(value).trimEnd()
}
