import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plug, Search, X } from 'lucide-react'
import { COMMANDS, commandsBySection } from '../commands/registry'
import { displayChord, effectiveBindings } from '../commands/keymap'
import { useCommandScope } from '../commands/provider'
import { useApp } from '../state/app'

const FINE_PRINT: Partial<Record<(typeof COMMANDS)[number]['section'], React.ReactNode>> = {
  Run: (
    <>
      Ticks are your own progress marks. They are stored app-locally, never in{' '}
      <span className="mono">report.json</span>, and clear when a run is reopened.
    </>
  ),
  Verdicts: (
    <>
      Stored as the standard enum: Pass = <span className="mono">pass</span> · Partial ={' '}
      <span className="mono">partial</span> · Fail = <span className="mono">fail</span> · Skip ={' '}
      <span className="mono">skip</span>.
    </>
  ),
  'Light run': (
    <>
      A light run’s vocabulary is binary. A flag reads back as <span className="mono">fail</span>{' '}
      with your note, not as a graded failure.
    </>
  )
}

/** The registry-rendered wide keyboard sheet. Mod+/ remains reachable in text fields. */
export function CheatSheet(): React.JSX.Element | null {
  const { helpOpen, setHelpOpen, settings, navigate } = useApp()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const overrides = useMemo(() => settings?.keymap ?? {}, [settings?.keymap])
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = COMMANDS.filter((command) => {
      const bindings = effectiveBindings(command, overrides).map(displayChord).join(' ')
      return (
        !needle || `${command.title} ${command.section} ${bindings}`.toLowerCase().includes(needle)
      )
    })
    return commandsBySection(filtered)
  }, [overrides, query])

  useEffect(() => {
    if (!helpOpen) return
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [helpOpen])

  const close = useCallback(() => {
    setHelpOpen(false)
    returnFocusRef.current?.focus()
    returnFocusRef.current = null
  }, [setHelpOpen])

  useCommandScope(
    helpOpen
      ? {
          'app.cheat-sheet': { priority: 100, handler: close },
          'app.close-back': { priority: 100, handler: close }
        }
      : {}
  )

  if (!helpOpen) return null

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="sheetwide">
        <div className="shead">
          <h2>Keyboard shortcuts</h2>
          <label className="sfilter">
            <Search className="ic s" strokeWidth={2} />
            <input
              ref={inputRef}
              value={query}
              placeholder="Filter by command or key…"
              aria-label="Filter keyboard shortcuts"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {/* Help's way to the first-run steps (ticket 34). */}
          <button
            type="button"
            className="ghostbtn"
            onClick={() => {
              setHelpOpen(false)
              navigate({ kind: 'get-started' })
            }}
          >
            <Plug className="ic" strokeWidth={2} />
            Get started
          </button>
          <button className="iconbtn" aria-label="Close" onClick={close}>
            <X className="ic" strokeWidth={2} />
          </button>
        </div>
        <div className="sheetbody">
          {groups.map((group) => (
            <section className="grp" key={group.section}>
              <h3>{group.section}</h3>
              {group.commands.map((command) => {
                const bindings = effectiveBindings(command, overrides)
                return (
                  <div
                    className="krow"
                    key={command.id}
                    data-testid={`cheat-command:${command.id}`}
                  >
                    <span className="keys">
                      {bindings.map((binding) => (
                        <kbd key={binding}>{displayChord(binding)}</kbd>
                      ))}
                    </span>
                    <span className={`kl${bindings.length ? '' : ' unb'}`}>{command.title}</span>
                  </div>
                )
              })}
              {FINE_PRINT[group.section] && (
                <div className="fineprint">{FINE_PRINT[group.section]}</div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
