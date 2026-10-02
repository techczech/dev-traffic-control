import { createElement } from 'react'
import type { ReactNode } from 'react'
import { slugify, uniqueId } from '../../../main/qa/slug'

/**
 * Render `**bold**` runs to `<strong>` elements, leaving everything else as
 * plain string nodes. Escape-safe by construction: text is only ever handed to
 * React as string children, so React escapes it — no HTML is interpreted. This
 * is the only Markdown Dev Traffic Control renders in M3.
 */
export function renderBold(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(createElement('strong', { key: key++ }, m[1]))
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

// ---------------------------------------------------------------------------
// Reading-surface markdown (M7). The Snapshot renders through a small block
// parser that returns pure data: the view and the anchor-resolution maths in
// reviewState share one representation of the document's text. Everything is
// escape-safe the same way renderBold is — text only ever reaches React as
// string children. Unknown constructs degrade to plain paragraph text; the
// parser never throws and never drops content (M7 T2).

export type InlineStyle = 'plain' | 'bold' | 'italic' | 'code'
export interface InlineRun {
  text: string
  style: InlineStyle
  href?: string // set on `[text](url)` links; text renders in `style`
}

/** An image linked to a decision option. */
export interface OptionPicture {
  src: string
  alt: string
}

export interface DocListItem {
  runs: InlineRun[]
  sub?: { ordered: boolean; items: InlineRun[][] } // one nesting level only
}

export type DocBlock =
  | { kind: 'title'; runs: InlineRun[] } // the document's own `# H1`
  | { kind: 'heading'; level: 2 | 3; id: string; runs: InlineRun[] }
  | { kind: 'para'; runs: InlineRun[] }
  | { kind: 'list'; ordered: boolean; items: DocListItem[] }
  | { kind: 'code'; text: string }
  // Visual review blocks: a markdown table, a block image, and an embedded
  // mockup (an ```html or ```svg fence) rendered in a sandboxed frame.
  | { kind: 'table'; header: InlineRun[][]; rows: InlineRun[][][] }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'embed'; lang: 'html' | 'svg'; code: string }
  // A decision toggle (a ```decision fence): a question plus clickable
  // options the reviewer answers with one click instead of a comment.
  // `pictures[i]` are the images linked to `options[i]` (empty when none);
  // `section` is the nearest preceding H2/H3 id, null before any heading.
  | {
      kind: 'decision'
      id: string
      question: InlineRun[]
      options: string[]
      pictures: OptionPicture[][]
      section: string | null
    }

// One alternation, ordered so `code` beats links and `**` beats `*`. The
// lookarounds keep intra-word stars/underscores (file_names_like_this) literal.
const INLINE_RE =
  /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+?)\*\*|(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])|(?<![\w_])_([^_\s][^_]*?)_(?![\w_])/g

/** Split inline markdown into styled runs; unmatched markers stay literal. */
export function tokenizeInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), style: 'plain' })
    if (m[1] !== undefined) runs.push({ text: m[1], style: 'code' })
    else if (m[2] !== undefined) runs.push({ text: m[2], style: 'plain', href: m[3] })
    else if (m[4] !== undefined) runs.push({ text: m[4], style: 'bold' })
    else runs.push({ text: m[5] ?? m[6], style: 'italic' })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last), style: 'plain' })
  return runs
}

/** The plain text a reader sees for a set of runs — the selection/anchor space. */
export function runsText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join('')
}

/**
 * Parse a ```decision fence body into a decision block. The first non-option
 * line is the question (a leading `Q:`/`Question:` is stripped); `- ` lines are
 * the clickable options. With no options, the default verdict trio is used. The
 * id is the fence's `{#id}` pin, else a slug of the question, deduped against
 * `taken` (shared with heading ids) so it survives request regeneration.
 */
function makeDecision(body: string, explicitId: string, taken: Set<string>): DocBlock {
  let question = ''
  const options: string[] = []
  const pictures: OptionPicture[][] = []
  for (const raw of body.split(/\r?\n/)) {
    const l = raw.trim()
    if (!l) continue
    const opt = l.match(/^[-*]\s+(.+)$/)
    if (opt) {
      // Pictures ride on the option line as `![alt](src)`; they leave the label.
      const pics: OptionPicture[] = []
      const label = opt[1]
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
          pics.push({ alt, src: src.trim() })
          return ' '
        })
        .replace(/\s+/g, ' ')
        .trim()
      options.push(label || pics[0]?.alt.trim() || `Option ${options.length + 1}`)
      pictures.push(pics)
    } else if (!question) question = l.replace(/^(?:Q|Question)\s*[:.]\s*/i, '')
  }
  if (options.length === 0) {
    options.push('Approve', 'Needs change', 'Reject')
    pictures.push([], [], [])
  }
  const id = uniqueId(explicitId || slugify(question) || 'decision', taken)
  taken.add(id)
  return {
    kind: 'decision',
    id,
    question: tokenizeInline(question),
    options,
    pictures,
    section: null
  }
}

/** The text before an option's first colon (`AS-3A: shelf` -> `AS-3A`), else the whole label. */
export function optionShortLabel(label: string): string {
  const i = label.indexOf(':')
  return (i > 0 ? label.slice(0, i) : label).trim()
}

/** `AS-3A: shelf` -> `['AS-3A', 'shelf']`; a label with no colon has no rest. */
export function splitOptionLabel(label: string): [string, string] {
  const i = label.indexOf(':')
  if (i <= 0) return [label, '']
  return [label.slice(0, i).trim(), label.slice(i + 1).trim()]
}

/**
 * Second pass: stamp each decision with its section and, for a decision whose
 * options carry no inline picture, link the same section's block images whose
 * alt starts with `<short label>:` exactly (`AS-3A:` matches `AS-3A: …`; `A:`
 * does not). Linked images leave the body so they are not shown twice.
 */
function linkDecisionPictures(blocks: DocBlock[]): DocBlock[] {
  const sectionOf: (string | null)[] = []
  let section: string | null = null
  for (const b of blocks) {
    if (b.kind === 'heading') section = b.id
    sectionOf.push(section)
  }
  const consumed = new Set<number>()
  blocks.forEach((b, i) => {
    if (b.kind !== 'decision') return
    b.section = sectionOf[i]
    if (b.pictures.some((p) => p.length > 0)) return
    b.options.forEach((label, o) => {
      const prefix = `${optionShortLabel(label)}:`
      blocks.forEach((img, j) => {
        if (img.kind !== 'image' || consumed.has(j) || sectionOf[j] !== b.section) return
        if (!img.alt.startsWith(prefix)) return
        consumed.add(j)
        b.pictures[o].push({ src: img.src, alt: img.alt })
      })
    })
  })
  return consumed.size ? blocks.filter((_b, i) => !consumed.has(i)) : blocks
}

/**
 * Parse a Snapshot body into blocks. Heading ids use the SAME slug logic as
 * main's `parseDocument` (shared `slug.ts`, `{#id}` pins honoured, `uniqueId`
 * dedup, fences skipped) so a rendered heading id always equals the TOC id.
 */
export function parseDocBlocks(bodyMarkdown: string): DocBlock[] {
  const blocks: DocBlock[] = []
  const taken = new Set<string>()
  let para: string[] = []
  let list: { ordered: boolean; items: DocListItem[] } | null = null
  let code: string[] | null = null
  let fenceLang = ''
  let fenceId = ''
  let tableBuf: string[] = []

  // Close a fenced block into the right kind: decision, embedded mockup, or
  // plain code. Called both mid-body (on the closing ```) and at EOF.
  const flushCode = (): void => {
    if (!code) return
    if (fenceLang === 'decision') {
      blocks.push(makeDecision(code.join('\n'), fenceId, taken))
    } else if (fenceLang === 'html' || fenceLang === 'svg') {
      blocks.push({ kind: 'embed', lang: fenceLang, code: code.join('\n') })
    } else {
      blocks.push({ kind: 'code', text: code.join('\n') })
    }
    code = null
    fenceLang = ''
    fenceId = ''
  }

  const flushPara = (): void => {
    if (para.length) blocks.push({ kind: 'para', runs: tokenizeInline(para.join(' ')) })
    para = []
  }
  const flushList = (): void => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }
  // A buffer of consecutive `| ... |` lines becomes a table only if the second
  // line is a `|---|` separator; otherwise the pipes were literal prose.
  const flushTable = (): void => {
    if (!tableBuf.length) return
    const buf = tableBuf
    tableBuf = []
    const looksSep = buf.length >= 2 && /-/.test(buf[1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(buf[1])
    if (!looksSep) {
      for (const l of buf) para.push(l.trim())
      flushPara()
      return
    }
    const cells = (row: string): InlineRun[][] =>
      row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => tokenizeInline(c.trim()))
    blocks.push({ kind: 'table', header: cells(buf[0]), rows: buf.slice(2).map(cells) })
  }

  for (const line of bodyMarkdown.split(/\r?\n/)) {
    if (code) {
      if (/^\s*(```|~~~)/.test(line)) flushCode()
      else code.push(line)
      continue
    }
    // Table rows accumulate; any other line ends the table.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara()
      flushList()
      tableBuf.push(line)
      continue
    } else if (tableBuf.length) {
      flushTable()
    }
    const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)(.*)$/)
    if (fence) {
      flushPara()
      flushList()
      code = []
      fenceLang = (fence[2] || '').toLowerCase()
      const idm = fence[3].match(/\{#([a-z0-9-]+)\}/i)
      fenceId = idm ? idm[1].toLowerCase() : ''
      continue
    }
    // The URL runs to the final `)` at end of line, so data URLs with spaces
    // and raw markup (e.g. `data:image/svg+xml;utf8,<svg ...>`) still match —
    // the leading `![` already commits the line to being an image.
    const img = line.match(/^!\[([^\]]*)\]\((.+)\)\s*$/)
    if (img) {
      flushPara()
      flushList()
      blocks.push({ kind: 'image', alt: img[1], src: img[2] })
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.+?)\s*$/)
    if (h) {
      flushPara()
      flushList()
      if (h[1].length === 1) {
        blocks.push({ kind: 'title', runs: tokenizeInline(h[2]) })
        continue
      }
      let title = h[2]
      let id: string | undefined
      const explicit = title.match(/\{#([a-z0-9-]+)\}\s*$/i)
      if (explicit) {
        id = explicit[1].toLowerCase()
        title = title.slice(0, explicit.index).trim()
      }
      id = uniqueId(id ?? slugify(title), taken)
      taken.add(id)
      blocks.push({
        kind: 'heading',
        level: h[1].length as 2 | 3,
        id,
        runs: tokenizeInline(title)
      })
      continue
    }
    const b = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
    if (b) {
      flushPara()
      const nested = b[1].length >= 2
      const ordered = /^\d+\.$/.test(b[2])
      const runs = tokenizeInline(b[3].trim())
      if (nested && list && list.items.length > 0) {
        const parent = list.items[list.items.length - 1]
        if (!parent.sub) parent.sub = { ordered, items: [] }
        parent.sub.items.push(runs)
      } else {
        if (list && list.ordered !== ordered) flushList()
        if (!list) list = { ordered, items: [] }
        list.items.push({ runs })
      }
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    // Anything else — plain prose, `####`, tables, blockquotes — reads as
    // paragraph text, verbatim.
    flushList()
    para.push(line.trim())
  }
  flushCode() // an unclosed fence keeps its content as its kind
  flushTable()
  flushPara()
  flushList()
  return linkDecisionPictures(blocks)
}

/**
 * Render inline runs as React nodes: bold → strong, italic → em, code → code,
 * links → external anchors (the window-open handler routes them to the system
 * browser). Same escape-safety as {@link renderBold}.
 */
export function renderRuns(runs: InlineRun[]): ReactNode[] {
  return runs.map((r, i) => {
    if (r.href) {
      return createElement(
        'a',
        { key: i, href: r.href, target: '_blank', rel: 'noreferrer' },
        r.text
      )
    }
    if (r.style === 'bold') return createElement('strong', { key: i }, r.text)
    if (r.style === 'italic') return createElement('em', { key: i }, r.text)
    if (r.style === 'code') return createElement('code', { key: i }, r.text)
    return r.text
  })
}
