export interface TextMatch {
  start: number
  end: number
}

export function findTextMatches(text: string, query: string): TextMatch[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const haystack = text.toLocaleLowerCase()
  const matches: TextMatch[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from)
    if (start < 0) break
    matches.push({ start, end: start + needle.length })
    from = start + Math.max(needle.length, 1)
  }
  return matches
}

export function nextMatchIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}
