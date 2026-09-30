import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecordSearchHit, RecordSearchResult } from '../../../shared/ipc'
import { useCommandScope } from '../commands/provider'
import { useApp } from '../state/app'

const EMPTY: RecordSearchResult = { hits: [], total: 0, files: 0, cap: 100, capped: false }

function highlightedSnippet(snippet: string, query: string): React.JSX.Element {
  const at = snippet.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())
  if (at < 0 || !query.trim()) return <>{snippet}</>
  return (
    <>
      {snippet.slice(0, at)}
      <mark className="hit">{snippet.slice(at, at + query.trim().length)}</mark>
      {snippet.slice(at + query.trim().length)}
    </>
  )
}

export function SearchEverything({ open }: { open: boolean }): React.JSX.Element | null {
  const { navigate, closeSearchEverything } = useApp()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<RecordSearchResult>(EMPTY)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const clamped = Math.min(active, Math.max(0, result.hits.length - 1))

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open || !query.trim()) return
    let cancelled = false
    const timer = setTimeout(() => {
      void window.qa.searchRecord(query).then((next) => {
        if (cancelled) return
        setResult(next)
        setActive(0)
        setSearching(false)
      })
    }, 80)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query])

  const grouped = useMemo(() => {
    const groups: Array<{ kind: RecordSearchHit['kind']; label: string; hits: RecordSearchHit[] }> =
      [
        { kind: 'request', label: 'Requests', hits: [] },
        { kind: 'entry', label: 'Thread entries', hits: [] },
        { kind: 'note', label: 'Notes', hits: [] }
      ]
    for (const hit of result.hits) groups.find((group) => group.kind === hit.kind)?.hits.push(hit)
    return groups.filter((group) => group.hits.length)
  }, [result.hits])

  function close(): void {
    setQuery('')
    setResult(EMPTY)
    setActive(0)
    closeSearchEverything()
  }

  function go(hit: RecordSearchHit | undefined): void {
    if (!hit) return
    const search = { file: hit.file, line: hit.line, query }
    if (hit.kind === 'request') navigate({ kind: 'runner', path: hit.file, search })
    else if (hit.kind === 'note') navigate({ kind: 'note', path: hit.file, search })
    else if (hit.thread)
      navigate({
        kind: 'thread',
        project: hit.project,
        thread: hit.thread,
        search
      })
    close()
  }

  useCommandScope(
    open
      ? {
          'palette.move-down': {
            priority: 110,
            handler: () => result.hits.length && setActive((clamped + 1) % result.hits.length)
          },
          'palette.move-up': {
            priority: 110,
            handler: () =>
              result.hits.length &&
              setActive((clamped - 1 + result.hits.length) % result.hits.length)
          },
          'palette.run': { priority: 110, handler: () => go(result.hits[clamped]) },
          'app.close-back': { priority: 110, handler: close }
        }
      : {}
  )

  if (!open) return null
  return (
    <div className="overlay top" role="dialog" aria-modal="true" aria-label="Search everything">
      <div className="cmdk search-everything">
        <div className="ckin">
          <Search className="ic" strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            aria-label="Search requests, notes and thread entries"
            placeholder="Search requests, notes and thread entries…"
            onChange={(event) => {
              const value = event.target.value
              setQuery(value)
              setActive(0)
              if (!value.trim()) {
                setResult(EMPTY)
                setSearching(false)
              } else setSearching(true)
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cklist" role="listbox">
          {!query.trim() ? (
            <div className="ckempty">Search inside every request, note and thread entry.</div>
          ) : searching ? (
            <div className="ckempty">Searching bodies…</div>
          ) : result.hits.length === 0 ? (
            <div className="ckempty">Nothing matches “{query}”.</div>
          ) : (
            grouped.map((group) => (
              <div key={group.kind}>
                <div className="cksec">{group.label}</div>
                {group.hits.map((hit) => {
                  const index = result.hits.indexOf(hit)
                  return (
                    <button
                      key={`${hit.file}:${hit.line}:${hit.column}`}
                      className={`srow${index === clamped ? ' act' : ''}`}
                      role="option"
                      aria-selected={index === clamped}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(hit)}
                    >
                      <span className="l1">
                        <span className="st">{hit.title}</span>
                        <span className="sk">{hit.kind}</span>
                        <span className="grow" />
                        <span className="sp">
                          {hit.project} · L{hit.line}
                        </span>
                      </span>
                      <span className="sn">{highlightedSnippet(hit.snippet, query)}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        {result.capped && (
          <div className="capped pinned">
            Showing the first{' '}
            <b>
              {result.cap} of {result.total} matches
            </b>{' '}
            across {result.files} files. Narrow the search to see the rest.
          </div>
        )}
        <div className="ckfoot">
          <span>
            <kbd>↑↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open at this line
          </span>
          <span className="grow" />
          <span>Bodies, not titles</span>
        </div>
      </div>
    </div>
  )
}
