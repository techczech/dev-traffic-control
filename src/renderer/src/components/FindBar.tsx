import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCommandScope } from '../commands/provider'
import { findTextMatches, nextMatchIndex } from '../lib/documentFind'

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown
}

function highlightRegistry(): HighlightRegistry | null {
  return (
    (globalThis.CSS as (typeof CSS & { highlights?: HighlightRegistry }) | undefined)?.highlights ??
    null
  )
}

function highlightConstructor(): HighlightConstructor | null {
  return (window as typeof window & { Highlight?: HighlightConstructor }).Highlight ?? null
}

function textNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      return parent?.closest('button, input, textarea, select, [aria-hidden="true"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    }
  })
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes
}

function rangesFor(root: Element, query: string): Range[] {
  const nodes = textNodes(root)
  const joined = nodes.map((node) => node.data).join('')
  const matches = findTextMatches(joined, query)
  const starts: number[] = []
  let offset = 0
  for (const node of nodes) {
    starts.push(offset)
    offset += node.length
  }
  return matches.flatMap((match) => {
    const startNode = nodes.findIndex(
      (node, index) => match.start >= starts[index] && match.start < starts[index] + node.length
    )
    const endNode = nodes.findIndex(
      (node, index) => match.end > starts[index] && match.end <= starts[index] + node.length
    )
    if (startNode < 0 || endNode < 0) return []
    const range = document.createRange()
    range.setStart(nodes[startNode], match.start - starts[startNode])
    range.setEnd(nodes[endNode], match.end - starts[endNode])
    return [range]
  })
}

function publishHighlights(ranges: Range[], current: number): void {
  const registry = highlightRegistry()
  const Highlight = highlightConstructor()
  if (!registry || !Highlight) return
  registry.delete('dtc-find')
  registry.delete('dtc-find-current')
  if (ranges.length) registry.set('dtc-find', new Highlight(...ranges))
  if (ranges[current]) registry.set('dtc-find-current', new Highlight(ranges[current]))
}

function clearHighlights(): void {
  const registry = highlightRegistry()
  registry?.delete('dtc-find')
  registry?.delete('dtc-find-current')
}

export function FindBar({
  open,
  onClose,
  returnFocus
}: {
  open: boolean
  onClose: () => void
  returnFocus?: HTMLElement | null
}): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [current, setCurrent] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => () => clearHighlights(), [])

  function updateQuery(value: string): void {
    setQuery(value)
    const root = document.querySelector('[data-find-scope]')
    const next = root ? rangesFor(root, value) : []
    setRanges(next)
    setCurrent(next.length ? 0 : -1)
    publishHighlights(next, next.length ? 0 : -1)
  }

  const move = useCallback(
    (direction: 1 | -1) => {
      const next = nextMatchIndex(current, ranges.length, direction)
      setCurrent(next)
      publishHighlights(ranges, next)
      const element = ranges[next]?.startContainer.parentElement
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'center' })
      }
    },
    [current, ranges]
  )
  const close = useCallback(() => {
    clearHighlights()
    onClose()
    returnFocus?.focus()
  }, [onClose, returnFocus])

  useCommandScope(
    open
      ? {
          'find.next': { priority: 120, handler: () => move(1) },
          'find.previous': { priority: 120, handler: () => move(-1) },
          'app.close-back': { priority: 120, handler: close }
        }
      : {}
  )

  if (!open) return null
  return (
    <div className="findbar">
      <Search className="ic" strokeWidth={2} />
      <input
        ref={inputRef}
        value={query}
        aria-label="Find in document"
        placeholder="Find in this document…"
        onChange={(event) => updateQuery(event.target.value)}
      />
      <span className="count">
        {ranges.length ? `${current + 1} of ${ranges.length}` : query ? 'No matches' : '0 matches'}
      </span>
      <span className="navb">
        <button className="iconbtn" aria-label="Previous match" onClick={() => move(-1)}>
          <ChevronUp size={14} />
        </button>
        <button className="iconbtn" aria-label="Next match" onClick={() => move(1)}>
          <ChevronDown size={14} />
        </button>
        <button className="iconbtn" aria-label="Close find" onClick={close}>
          <X size={14} />
        </button>
      </span>
    </div>
  )
}
