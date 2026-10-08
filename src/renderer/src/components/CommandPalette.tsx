import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, Search } from 'lucide-react'
import { useApp } from '../state/app'
import { useCommandScope, useCommands } from '../commands/provider'
import { COMMANDS, commandsBySection } from '../commands/registry'
import type { CommandDefinition, CommandId } from '../commands/registry'
import { applyRebind, displayChord, findBindingConflicts, removeOverride } from '../commands/keymap'

interface PendingConflict {
  chord: string
  owners: CommandDefinition[]
}

const CONFLICT_CONFIRM_KEY = 'Y'

export function CommandPalette(): React.JSX.Element | null {
  const {
    commandPaletteOpen,
    commandPaletteMode,
    closeCommandPalette,
    view,
    snapshot,
    selectedPath
  } = useApp()
  const commands = useCommands()
  const captureNextChord = commands.captureNextChord
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [capturing, setCapturing] = useState<CommandId | null>(null)
  const [conflict, setConflict] = useState<PendingConflict | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const openRef = useRef(commandPaletteOpen)

  const available = commands.available()
  const availableIds = useMemo(() => new Set(available.map((entry) => entry.id)), [available])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const candidates = commandPaletteMode === 'all' ? COMMANDS : available
    return candidates.filter((entry) => {
      if (commandPaletteMode === 'contextual' && (!entry.contextual || !availableIds.has(entry.id)))
        return false
      return !needle || `${entry.title} ${entry.section}`.toLowerCase().includes(needle)
    })
  }, [available, availableIds, commandPaletteMode, query])
  const clamped = Math.min(active, Math.max(0, filtered.length - 1))
  const highlighted = filtered[clamped]

  useEffect(() => {
    if (!commandPaletteOpen) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [commandPaletteOpen])

  useEffect(
    () => () => {
      captureNextChord(null)
    },
    [captureNextChord]
  )

  useEffect(() => {
    openRef.current = commandPaletteOpen
    if (!commandPaletteOpen) captureNextChord(null)
  }, [captureNextChord, commandPaletteOpen])

  function close(): void {
    openRef.current = false
    captureNextChord(null)
    setQuery('')
    setActive(0)
    setCapturing(null)
    setConflict(null)
    closeCommandPalette()
  }

  function executeHighlighted(): void {
    if (!highlighted || capturing) return
    if (highlighted.id === 'app.rebind-highlighted') {
      commands.run(highlighted.id as CommandId)
    } else if (availableIds.has(highlighted.id)) {
      close()
      commands.run(highlighted.id as CommandId)
    }
  }

  function confirmConflict(): void {
    if (!conflict || !capturing) return
    const next = applyRebind(
      Object.fromEntries([
        ...Object.entries(commands.overrides),
        ...conflict.owners.map((owner) => [owner.id, ''])
      ]),
      capturing,
      conflict.chord
    )
    captureNextChord(null)
    commands.onOverridesChange(next)
    setConflict(null)
    setCapturing(null)
  }

  function cancelCapture(): void {
    captureNextChord(null)
    setCapturing(null)
    setConflict(null)
  }

  function startCapture(): void {
    if (!highlighted) return
    const id = highlighted.id as CommandId
    setCapturing(id)
    setConflict(null)
    captureNextChord(
      (chord) => {
        if (chord === 'Escape') {
          captureNextChord(null)
          setCapturing(null)
          setConflict(null)
          return
        }
        if (chord === 'Backspace') {
          captureNextChord(null)
          commands.onOverridesChange({ ...commands.overrides, [id]: '' })
          setCapturing(null)
          return
        }
        if (chord === 'Mod+Backspace') {
          captureNextChord(null)
          commands.onOverridesChange(removeOverride(commands.overrides, id))
          setCapturing(null)
          return
        }
        const owners = findBindingConflicts(COMMANDS, commands.overrides, id, chord)
        if (owners.length) {
          const pending = { chord, owners }
          setConflict(pending)
          // Y is deliberately capture-local, not a registry binding. Keeping
          // capture armed makes confirmation reachable even when Enter, Y, or
          // every palette command has been rebound globally.
          captureNextChord(
            (confirmation) => {
              if (confirmation === CONFLICT_CONFIRM_KEY) {
                const next = applyRebind(
                  Object.fromEntries([
                    ...Object.entries(commands.overrides),
                    ...pending.owners.map((owner) => [owner.id, ''])
                  ]),
                  id,
                  pending.chord
                )
                captureNextChord(null)
                commands.onOverridesChange(next)
                setConflict(null)
                setCapturing(null)
              } else if (confirmation === 'Escape') {
                cancelCapture()
              }
            },
            () => openRef.current
          )
          return
        }
        captureNextChord(null)
        commands.onOverridesChange(applyRebind(commands.overrides, id, chord))
        setCapturing(null)
      },
      () => openRef.current
    )
  }

  function restoreDefault(): void {
    if (!highlighted) return
    commands.onOverridesChange(removeOverride(commands.overrides, highlighted.id as CommandId))
    setConflict(null)
    setCapturing(null)
    captureNextChord(null)
  }

  useCommandScope(
    commandPaletteOpen
      ? {
          'palette.move-down': {
            priority: 100,
            handler: () =>
              setActive((value) => (filtered.length ? (clamped + 1) % filtered.length : value))
          },
          'palette.move-up': {
            priority: 100,
            handler: () =>
              setActive((value) =>
                filtered.length ? (clamped - 1 + filtered.length) % filtered.length : value
              )
          },
          'palette.run': { priority: 100, handler: executeHighlighted },
          'app.rebind-highlighted': { priority: 100, handler: startCapture },
          'palette.restore-default': { priority: 100, handler: restoreDefault },
          'app.close-back': { priority: 100, handler: close }
        }
      : {}
  )

  if (!commandPaletteOpen) return null

  const context = contextualLabel(view, snapshot, selectedPath)
  return (
    <div
      className="overlay top"
      role="dialog"
      aria-modal="true"
      aria-label={commandPaletteMode === 'contextual' ? 'Contextual actions' : 'Command palette'}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="cmdk">
        {commandPaletteMode === 'contextual' && context && (
          <div className="cksel">
            <span className="lab">Acting on</span>
            <span className="what">{context.label}</span>
            <span className="kindb">{context.kind}</span>
          </div>
        )}
        <div className="ckin">
          {commandPaletteMode === 'contextual' ? (
            <Search className="ic" strokeWidth={2} />
          ) : (
            <Command className="ic" strokeWidth={2} />
          )}
          <input
            ref={inputRef}
            value={query}
            placeholder={commandPaletteMode === 'contextual' ? 'Filter actions…' : 'Run a command…'}
            aria-label="Filter commands"
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cklist" role="listbox">
          {filtered.length === 0 ? (
            <div className="ckempty">Nothing matches “{query}”.</div>
          ) : (
            commandsBySection(filtered).map((group) => (
              <div key={group.section}>
                <div className="cksec">{group.section}</div>
                {group.commands.map((entry) => {
                  const index = filtered.indexOf(entry)
                  const isActive = index === clamped
                  const isCapturing = capturing === entry.id
                  const isAvailable = availableIds.has(entry.id)
                  const live = commands.bindings(entry)
                  return (
                    <div key={entry.id}>
                      <button
                        className={`ckrow${isActive ? ' act' : ''}${isCapturing ? ' capturing' : ''}${isAvailable ? '' : ' unavailable'}`}
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={!isAvailable}
                        data-testid={`palette-command:${entry.id}`}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => {
                          setActive(index)
                          if (entry.id === 'app.rebind-highlighted') {
                            commands.run(entry.id as CommandId)
                          } else if (!isCapturing && isAvailable) {
                            close()
                            commands.run(entry.id as CommandId)
                          }
                        }}
                      >
                        <span className="cklabel">{entry.title}</span>
                        <span className="grow" />
                        {isCapturing ? (
                          <span className="capnote">Press the new chord…</span>
                        ) : live.length ? (
                          <span className="keys">
                            {live.map((chord) => (
                              <kbd key={chord}>{displayChord(chord)}</kbd>
                            ))}
                          </span>
                        ) : (
                          <span className="unbound">unbound</span>
                        )}
                      </button>
                      {isCapturing && conflict && (
                        <div className="conflict" role="alert">
                          <span>
                            <b>{displayChord(conflict.chord)}</b> is currently{' '}
                            <b>{conflict.owners.map((owner) => owner.title).join(', ')}</b>. Press{' '}
                            <b>{CONFLICT_CONFIRM_KEY}</b> or choose Move binding; press Esc to
                            cancel.
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="ckfoot">
          {capturing && conflict ? (
            <>
              <span>
                <kbd>{CONFLICT_CONFIRM_KEY}</kbd> confirm
              </span>
              <span>
                <kbd>Esc</kbd> cancel
              </span>
              <span className="grow" />
              <button type="button" className="retry" onClick={confirmConflict}>
                Move binding
              </button>
            </>
          ) : capturing ? (
            <>
              <span>
                <kbd>⌫</kbd> unbind
              </span>
              <span>
                <kbd>⌘⌫</kbd> restore default
              </span>
              <span>
                <kbd>Esc</kbd> cancel
              </span>
            </>
          ) : (
            <>
              <span>
                <kbd>↑↓</kbd> move
              </span>
              <span>
                <kbd>↵</kbd> run
              </span>
              <span className="grow" />
              <span>
                <kbd>⌘⇧,</kbd> rebind
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function contextualLabel(
  view: ReturnType<typeof useApp>['view'],
  snapshot: ReturnType<typeof useApp>['snapshot'],
  selectedPath: string | null
): { label: string; kind: string } | null {
  const path = view.kind === 'runner' ? view.path : selectedPath
  const run = path ? snapshot?.runs.find((candidate) => candidate.request.path === path) : null
  if (run)
    return { label: run.request.title, kind: run.request.mode === 'light' ? 'light run' : 'run' }
  if (view.kind === 'thread') return { label: view.thread, kind: 'thread' }
  return null
}
