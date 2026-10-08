import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { readConfinedText, recordRelative } from './confinedFs'
import { isNoteFileName } from './qa/scan'
import { parse as parseYaml } from 'yaml'
import type { RecordFileContent, RecordSearchHit, RecordSearchResult } from '../shared/ipc'

const SKIP_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md'])

const OUTSIDE_ROOT = 'Path is outside the record root'

/**
 * The path of `file` below the records folder, taken from the spelling that
 * was supplied. Nothing is resolved here: a path that only reaches a record
 * through a link must arrive at the confined read with the link still in it,
 * so the read refuses it.
 */
async function suppliedRelative(root: string, file: string): Promise<string> {
  try {
    return await recordRelative(root, file)
  } catch {
    throw new Error(OUTSIDE_ROOT)
  }
}

/**
 * The text of each named record file. A path that is not spelled below the
 * records folder fails the whole call. A path below it that the confined read
 * refuses (a link anywhere on the way, a file with more than one name, not a
 * regular file) or that is not there comes back with `content: null`.
 */
export async function readRecordFiles(
  root: string,
  files: readonly string[]
): Promise<RecordFileContent[]> {
  return Promise.all(
    files.map(async (file) => {
      const relative = await suppliedRelative(root, file)
      try {
        const content = await readConfinedText(root, relative)
        // No link lies between the root and the file that was read, so this is
        // the file's resolved path.
        return { file: path.join(await realpath(root), relative), content }
      } catch {
        return { file: path.resolve(file), content: null }
      }
    })
  )
}

interface BodyFile {
  file: string
  project: string
  kind: RecordSearchHit['kind']
  title: string
  thread?: string
  firstBodyLine: number
  bodyLines: string[]
}

function frontmatter(raw: string): {
  meta: Record<string, unknown>
  body: string
  firstBodyLine: number
} {
  const lines = raw.split(/\r?\n/)
  if (lines[0] !== '---') return { meta: {}, body: raw, firstBodyLine: 1 }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { meta: {}, body: raw, firstBodyLine: 1 }
  let meta: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(lines.slice(1, end).join('\n'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed
  } catch {
    // Search still works on the body when agent-authored YAML is malformed.
  }
  return { meta, body: lines.slice(end + 1).join('\n'), firstBodyLine: end + 2 }
}

function bodyFile(root: string, file: string, raw: string): BodyFile | null {
  const name = path.basename(file)
  if (!name.endsWith('.md') || SKIP_FILES.has(name) || name.endsWith('.resolved.md')) return null
  const relative = path.relative(root, file)
  const project = relative.split(path.sep)[0] ?? ''
  const parsed = frontmatter(raw)
  const thread = typeof parsed.meta.thread === 'string' ? parsed.meta.thread : undefined
  const kind: RecordSearchHit['kind'] = isNoteFileName(name) ? 'note' : thread ? 'entry' : 'request'
  const heading = parsed.body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
  const title =
    (typeof parsed.meta.title === 'string' && parsed.meta.title.trim()) ||
    heading ||
    name.replace(/\.md$/, '')
  return {
    file,
    project,
    kind,
    title,
    ...(thread ? { thread } : {}),
    firstBodyLine: parsed.firstBodyLine,
    bodyLines: parsed.body.split(/\r?\n/)
  }
}

async function markdownFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.shots')) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(full)
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full)
      // Dirent symlinks are deliberately ignored. Search never follows them.
    }
  }
  await visit(root)
  return files.filter((file) => isRecordCandidate(root, file)).sort()
}

function isRecordCandidate(root: string, file: string): boolean {
  const parts = path.relative(root, file).split(path.sep)
  if (parts.length === 2) return true
  if (parts.length !== 3) return false
  // These collections contain Markdown, but they are not requests, notes or
  // thread entries and are outside this search surface's contract.
  return parts[1] !== 'handoffs' && parts[1] !== 'releases'
}

function snippet(line: string, start: number, length: number): string {
  const padding = 72
  const from = Math.max(0, start - padding)
  const to = Math.min(line.length, start + length + padding)
  return `${from > 0 ? '…' : ''}${line.slice(from, to).trim()}${to < line.length ? '…' : ''}`
}

export async function searchRecordBodies(
  root: string,
  query: string,
  cap = 100
): Promise<RecordSearchResult> {
  const needle = query.trim().toLocaleLowerCase()
  const safeCap = Math.max(1, Math.min(cap, 500))
  if (!needle) return { hits: [], total: 0, files: 0, cap: safeCap, capped: false }
  const resolvedRoot = await realpath(root)
  const hits: RecordSearchHit[] = []
  const matchedFiles = new Set<string>()
  let total = 0
  for (const file of await markdownFiles(resolvedRoot)) {
    let raw: string
    try {
      raw = await readConfinedText(resolvedRoot, await recordRelative(resolvedRoot, file))
    } catch {
      // Removed, replaced by a link or moved since the walk listed it.
      continue
    }
    const record = bodyFile(resolvedRoot, file, raw)
    if (!record) continue
    record.bodyLines.forEach((line, index) => {
      const lower = line.toLocaleLowerCase()
      let from = 0
      while (from <= lower.length - needle.length) {
        const column = lower.indexOf(needle, from)
        if (column < 0) break
        total += 1
        matchedFiles.add(file)
        if (hits.length < safeCap) {
          hits.push({
            file,
            line: record.firstBodyLine + index,
            column: column + 1,
            snippet: snippet(line, column, needle.length),
            kind: record.kind,
            title: record.title,
            project: record.project,
            ...(record.thread ? { thread: record.thread } : {})
          })
        }
        from = column + needle.length
      }
    })
  }
  return {
    hits,
    total,
    files: matchedFiles.size,
    cap: safeCap,
    capped: total > safeCap
  }
}
