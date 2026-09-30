/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { COMMANDS, availableCommands, commandById, runCommand } from './registry'
import type { CommandDefinition, CommandId, CommandRuntime } from './registry'
import { bindingMatches, chordFromEvent, effectiveBinding, effectiveBindings } from './keymap'
import type { KeymapOverrides } from './keymap'

export interface CommandRegistration {
  handler: (event?: KeyboardEvent) => void
  enabled?: boolean
  priority?: number
  preventDefault?: boolean
}

export type CommandScope = Partial<
  Record<CommandId, ((event?: KeyboardEvent) => void) | CommandRegistration>
>

interface RegisteredCommand extends CommandRegistration {
  handler: (event?: KeyboardEvent) => void
}

interface CommandContextValue {
  revision: number
  overrides: KeymapOverrides
  onOverridesChange: (overrides: KeymapOverrides) => void
  updateScope: (token: symbol, scope: CommandScope | null) => void
  run: (id: CommandId, event?: KeyboardEvent) => boolean
  canRun: (id: CommandId) => boolean
  available: () => CommandDefinition[]
  binding: (id: CommandId) => string | null
  bindings: (command: CommandDefinition) => readonly string[]
  captureNextChord: (
    capture: ((chord: string, event: KeyboardEvent) => void) | null,
    active?: () => boolean
  ) => void
}

const CommandContext = createContext<CommandContextValue | null>(null)

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'))
}

export function CommandProvider({
  overrides,
  onOverridesChange,
  children
}: {
  overrides: KeymapOverrides
  onOverridesChange: (overrides: KeymapOverrides) => void
  children: ReactNode
}): React.JSX.Element {
  const scopes = useRef(new Map<symbol, CommandScope>())
  const captureRef = useRef<{
    capture: (chord: string, event: KeyboardEvent) => void
    active: () => boolean
  } | null>(null)
  const [revision, setRevision] = useState(0)

  const registrations = useCallback((id: CommandId): RegisteredCommand[] => {
    const found: RegisteredCommand[] = []
    for (const scope of scopes.current.values()) {
      const registration = scope[id]
      if (!registration) continue
      const normalised =
        typeof registration === 'function' ? { handler: registration } : registration
      if (normalised.enabled === false) continue
      found.push(normalised)
    }
    return found.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }, [])

  const runtime = useMemo<CommandRuntime>(
    () => ({
      revision,
      canInvoke: (id) => registrations(id).length > 0,
      invoke: (id, event) => registrations(id)[0]?.handler(event),
      contextLabel: null
    }),
    [registrations, revision]
  )

  const updateScope = useCallback((token: symbol, scope: CommandScope | null) => {
    const before = scopes.current.get(token)
    if (scope === null) scopes.current.delete(token)
    else scopes.current.set(token, scope)
    const signature = (value: CommandScope | undefined): string =>
      value
        ? Object.entries(value)
            .map(([id, registration]) =>
              !registration
                ? `${id}:false`
                : typeof registration === 'function'
                  ? `${id}:true`
                  : `${id}:${registration.enabled !== false}`
            )
            .sort()
            .join('|')
        : ''
    const beforeKeys = signature(before)
    const afterKeys = signature(scope ?? undefined)
    if (beforeKeys !== afterKeys) setRevision((value) => value + 1)
  }, [])

  const run = useCallback(
    (id: CommandId, event?: KeyboardEvent) => runCommand(id, runtime, event),
    [runtime]
  )
  const canRun = useCallback((id: CommandId) => commandById(id).when(runtime), [runtime])
  const available = useCallback(() => availableCommands(runtime), [runtime])
  const binding = useCallback((id: CommandId) => effectiveBinding(id, overrides), [overrides])
  const bindings = useCallback(
    (entry: CommandDefinition) => effectiveBindings(entry, overrides),
    [overrides]
  )
  const captureNextChord = useCallback(
    (
      capture: ((chord: string, event: KeyboardEvent) => void) | null,
      active: () => boolean = () => true
    ) => {
      captureRef.current = capture ? { capture, active } : null
    },
    []
  )

  useEffect(() => {
    function dispatch(event: KeyboardEvent): void {
      const chord = chordFromEvent(event)
      if (!chord) return
      if (captureRef.current && !captureRef.current.active()) captureRef.current = null
      if (captureRef.current) {
        event.preventDefault()
        event.stopImmediatePropagation()
        captureRef.current.capture(chord, event)
        return
      }
      const editing = isTextEntryTarget(event.target)
      const candidates = COMMANDS.filter((entry) => {
        if (!entry.when(runtime)) return false
        if (
          !effectiveBindings(entry, overrides).some((candidate) => bindingMatches(candidate, chord))
        ) {
          return false
        }
        if (!editing) return true
        if (entry.allowInText === 'always') return true
        return entry.allowInText === 'modified' && /^(Mod|Alt)\+/.test(chord)
      })
      const winner = candidates
        .map((entry) => ({
          entry,
          registration: registrations(entry.id as CommandId)[0],
          priority: registrations(entry.id as CommandId)[0]?.priority ?? 0
        }))
        .sort((a, b) => b.priority - a.priority)[0]?.entry
      if (!winner) return
      const registration = registrations(winner.id as CommandId)[0]
      if (registration?.preventDefault !== false) event.preventDefault()
      event.stopImmediatePropagation()
      run(winner.id as CommandId, event)
    }
    window.addEventListener('keydown', dispatch, true)
    return () => window.removeEventListener('keydown', dispatch, true)
  }, [overrides, registrations, run, runtime])

  const value = useMemo<CommandContextValue>(
    () => ({
      revision,
      overrides,
      onOverridesChange,
      updateScope,
      run,
      canRun,
      available,
      binding,
      bindings,
      captureNextChord
    }),
    [
      revision,
      overrides,
      onOverridesChange,
      updateScope,
      run,
      canRun,
      available,
      binding,
      bindings,
      captureNextChord
    ]
  )

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>
}

export function useCommands(): CommandContextValue {
  const context = useContext(CommandContext)
  if (!context) throw new Error('useCommands must be used within <CommandProvider>')
  return context
}

/**
 * A command's effective chord, overrides included, for a hint drawn beside a
 * control. Outside a provider (a component rendered on its own) it is the
 * default chord.
 */
export function useCommandChord(id: CommandId): string | null {
  const context = useContext(CommandContext)
  return context ? context.binding(id) : effectiveBinding(id, {})
}

export function useCommandScope(scope: CommandScope): void {
  const context = useContext(CommandContext)
  const updateScope = context?.updateScope
  const token = useRef(Symbol('command-scope'))
  const scopeRef = useRef(scope)
  useLayoutEffect(() => {
    scopeRef.current = scope
    updateScope?.(token.current, scope)
  })
  useLayoutEffect(
    () => () => {
      updateScope?.(token.current, null)
    },
    [updateScope]
  )
  useEffect(() => {
    if (updateScope) return
    function dispatch(event: KeyboardEvent): void {
      const chord = chordFromEvent(event)
      if (!chord) return
      const editing = isTextEntryTarget(event.target)
      const candidates = COMMANDS.flatMap((entry) => {
        const raw = scopeRef.current[entry.id as CommandId]
        if (!raw) return []
        const registration = typeof raw === 'function' ? { handler: raw } : raw
        if (registration.enabled === false) return []
        if (!effectiveBindings(entry, {}).some((binding) => bindingMatches(binding, chord)))
          return []
        if (
          editing &&
          entry.allowInText !== 'always' &&
          !(entry.allowInText === 'modified' && /^(Mod|Alt)\+/.test(chord))
        )
          return []
        return [{ entry, registration }]
      })
      const winner = candidates.sort(
        (a, b) => (b.registration.priority ?? 0) - (a.registration.priority ?? 0)
      )[0]
      if (!winner) return
      if (winner.registration.preventDefault !== false) event.preventDefault()
      event.stopImmediatePropagation()
      winner.registration.handler(event)
    }
    window.addEventListener('keydown', dispatch, true)
    return () => window.removeEventListener('keydown', dispatch, true)
  }, [updateScope])
}
