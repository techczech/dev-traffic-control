import { COMMANDS } from './registry'
import type { CommandDefinition, CommandId } from './registry'

export type KeymapOverrides = Record<string, string>

export interface ScopedBindingCollision<Scope extends string = string> {
  scope: Scope
  binding: string
  commandIds: string[]
}

export function effectiveBinding(id: CommandId, overrides: KeymapOverrides): string | null {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id] || null
  const command = commandFor(id)
  return command.defaultBinding
}

export function effectiveBindings(
  command: CommandDefinition,
  overrides: KeymapOverrides
): readonly string[] {
  if (Object.prototype.hasOwnProperty.call(overrides, command.id)) {
    return overrides[command.id] ? [overrides[command.id]] : []
  }
  return command.defaultBinding
    ? [command.defaultBinding, ...(command.alternateBindings ?? [])]
    : []
}

export function applyRebind(
  overrides: KeymapOverrides,
  id: CommandId,
  chord: string
): KeymapOverrides {
  const normalised = normaliseChord(chord)
  return { ...overrides, [id]: normalised }
}

export function removeOverride(overrides: KeymapOverrides, id: CommandId): KeymapOverrides {
  const next = { ...overrides }
  delete next[id]
  return next
}

export function findBindingConflicts(
  commands: readonly CommandDefinition[],
  overrides: KeymapOverrides,
  id: CommandId,
  chord: string
): CommandDefinition[] {
  const target = normaliseChord(chord)
  return commands.filter(
    (command) =>
      command.id !== id &&
      effectiveBindings(command, overrides).some((binding) => bindingMatches(binding, target))
  )
}

/** Finds bindings owned by two enabled commands in one declared command scope. */
export function findScopedBindingCollisions<Scope extends string>(
  commands: readonly CommandDefinition[],
  scopes: Readonly<Record<Scope, readonly CommandId[]>>,
  overrides: KeymapOverrides
): ScopedBindingCollision<Scope>[] {
  const byId = new Map(commands.map((entry) => [entry.id, entry]))
  const collisions: ScopedBindingCollision<Scope>[] = []

  for (const [scope, ids] of Object.entries(scopes) as Array<[Scope, readonly CommandId[]]>) {
    const owners = new Map<string, string[]>()
    for (const id of ids) {
      const entry = byId.get(id)
      if (!entry) throw new Error(`Unknown command in ${scope} scope: ${id}`)
      for (const binding of effectiveBindings(entry, overrides).flatMap(expandBinding)) {
        const chord = normaliseChord(binding)
        const commandIds = owners.get(chord) ?? []
        if (!commandIds.includes(id)) commandIds.push(id)
        owners.set(chord, commandIds)
      }
    }
    for (const [binding, commandIds] of owners) {
      if (commandIds.length > 1) collisions.push({ scope, binding, commandIds })
    }
  }

  return collisions
}

export function chordFromEvent(event: KeyboardEvent): string | null {
  if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) return '?'
  const key = eventKey(event)
  if (!key) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey && key !== '?') parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export function bindingMatches(binding: string, chord: string): boolean {
  if (binding === '1–9') return /^[1-9]$/.test(chord)
  return normaliseChord(binding) === normaliseChord(chord)
}

export function normaliseChord(chord: string): string {
  return chord
    .replaceAll('⌘', 'Mod+')
    .replaceAll('⌃', 'Ctrl+')
    .replaceAll('⌥', 'Alt+')
    .replaceAll('⇧', 'Shift+')
    .replace(/\++/g, '+')
    .replace(/\+$/, '')
}

export function displayChord(chord: string | null): string {
  if (!chord) return ''
  return chord
    .replace('Ctrl+', '⌃')
    .replace('Mod+', '⌘')
    .replace('Alt+', '⌥')
    .replace('Shift+', '⇧')
    .replace('ArrowDown', '↓')
    .replace('ArrowUp', '↑')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('Enter', '↵')
    .replace('Escape', 'Esc')
    .replace('Backspace', '⌫')
}

function eventKey(event: KeyboardEvent): string | null {
  if (
    event.key === 'Meta' ||
    event.key === 'Control' ||
    event.key === 'Alt' ||
    event.key === 'Shift'
  ) {
    return null
  }
  if (event.key === ' ') return 'Space'
  if (event.key === 'Esc') return 'Escape'
  const punctuation: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`'
  }
  if (punctuation[event.code]) return punctuation[event.code]
  // Shift turns a digit into its symbol — ⌘⇧0 arrives as `)` — so a shifted
  // digit is read from the key's position, as shifted punctuation is.
  if (event.shiftKey && /^Digit[0-9]$/.test(event.code ?? '')) return event.code.slice(5)
  if (event.key.length === 1) return event.key === '?' ? '?' : event.key.toUpperCase()
  return event.key
}

function expandBinding(binding: string): string[] {
  return binding === '1–9' ? ['1', '2', '3', '4', '5', '6', '7', '8', '9'] : [binding]
}

function commandFor(id: CommandId): CommandDefinition {
  // Lazy require would make this cycle obscure; the registry has no dependency
  // on keymap, so the direct import is safe.
  const command = COMMAND_CACHE.get(id)
  if (!command) throw new Error(`Unknown command: ${id}`)
  return command
}

const COMMAND_CACHE = new Map(COMMANDS.map((entry) => [entry.id, entry]))
