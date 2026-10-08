/**
 * Release records are Markdown, and their prose reaches the home and the
 * verdict sheet as a single line. Showing the raw marks (`*All projects*`,
 * `**new window**`) is wrong. This splits a line into plain, bold, italic and code
 * segments, for rendering as elements: never as HTML, so record text can
 * inject nothing. Unmatched marks stay as text.
 */
export type InlineSegment = { kind: 'text' | 'strong' | 'em' | 'code'; text: string }

const PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

export function inlineSegments(line: string): InlineSegment[] {
  const out: InlineSegment[] = []
  let last = 0
  for (const match of line.matchAll(PATTERN)) {
    const at = match.index ?? 0
    if (at > last) out.push({ kind: 'text', text: line.slice(last, at) })
    const token = match[0]
    if (token.startsWith('**') || token.startsWith('__'))
      out.push({ kind: 'strong', text: token.slice(2, -2) })
    else if (token.startsWith('`')) out.push({ kind: 'code', text: token.slice(1, -1) })
    else out.push({ kind: 'em', text: token.slice(1, -1) })
    last = at + token.length
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  return out
}

/** The same line with its marks removed, for a title attribute. */
export function inlinePlain(line: string): string {
  return inlineSegments(line)
    .map((segment) => segment.text)
    .join('')
}
