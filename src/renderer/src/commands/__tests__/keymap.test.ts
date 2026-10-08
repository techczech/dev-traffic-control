import { describe, expect, test } from 'vitest'
import { COMMANDS, RESERVED_COMMANDS, SURFACE_COMMANDS } from '../registry'
import {
  applyRebind,
  chordFromEvent,
  effectiveBinding,
  findBindingConflicts,
  findScopedBindingCollisions,
  removeOverride
} from '../keymap'

describe('keymap overrides', () => {
  test('the complete six-surface registry has no binding collision in a shared scope', () => {
    expect(findScopedBindingCollisions(COMMANDS, SURFACE_COMMANDS, {})).toEqual([])
  })

  test('a duplicate binding fails loudly with the scope, chord, and both owners', () => {
    const commands = COMMANDS.map((entry) =>
      entry.id === 'specs.questions' ? { ...entry, defaultBinding: 'Mod+3' } : entry
    )

    expect(findScopedBindingCollisions(commands, SURFACE_COMMANDS, {})).toEqual([
      {
        scope: 'specs',
        binding: 'Mod+3',
        commandIds: ['nav.specs', 'specs.questions']
      }
    ])
  })

  test('every registered command has a default binding', () => {
    expect(
      COMMANDS.filter((command) => !command.defaultBinding).map((command) => command.id)
    ).toEqual([])
  })

  test('reserved bindings belong only to their reserved commands', () => {
    for (const [id, binding] of Object.entries(RESERVED_COMMANDS)) {
      expect(effectiveBinding(id as keyof typeof RESERVED_COMMANDS, {})).toBe(binding)
      expect(
        COMMANDS.filter(
          (command) =>
            command.id !== id &&
            [command.defaultBinding, ...(command.alternateBindings ?? [])].includes(binding)
        ).map((command) => command.id)
      ).toEqual([])
    }
  })

  test('resolves defaults unless an override exists', () => {
    expect(effectiveBinding('app.command-palette', {})).toBe('Mod+Shift+P')
    expect(effectiveBinding('app.command-palette', { 'app.command-palette': 'Mod+P' })).toBe(
      'Mod+P'
    )
  })

  test('stores only the changed command and removing it restores the default', () => {
    const rebound = applyRebind({}, 'app.command-palette', 'Mod+P')
    expect(rebound).toEqual({ 'app.command-palette': 'Mod+P' })
    expect(removeOverride(rebound, 'app.command-palette')).toEqual({})
    expect(
      effectiveBinding('app.command-palette', removeOverride(rebound, 'app.command-palette'))
    ).toBe('Mod+Shift+P')
  })

  test('reports the command that already owns a captured chord', () => {
    const conflicts = findBindingConflicts(COMMANDS, {}, 'window.toggle-pin', 'Mod+Shift+P')
    expect(conflicts.map((entry) => entry.id)).toEqual(['app.command-palette'])
  })

  test('derives shifted punctuation from event.code instead of the shifted character', () => {
    expect(
      chordFromEvent({ key: '<', code: 'Comma', metaKey: true, shiftKey: true } as KeyboardEvent)
    ).toBe('Mod+Shift+,')
  })

  test('derives a shifted digit from event.code, so ⌘⇧0 is not read as ⌘⇧)', () => {
    expect(
      chordFromEvent({ key: ')', code: 'Digit0', metaKey: true, shiftKey: true } as KeyboardEvent)
    ).toBe('Mod+Shift+0')
    // Unshifted digits are unchanged: the 1–9 row bindings still read the key.
    expect(chordFromEvent({ key: '3', code: 'Digit3' } as KeyboardEvent)).toBe('3')
  })

  test('every registry default can be produced by a US or UK keyboard event', () => {
    for (const command of COMMANDS) {
      if (!command.defaultBinding || command.defaultBinding === '1–9') continue
      const event = eventForChord(command.defaultBinding)
      expect(chordFromEvent(event), `${command.id}: ${command.defaultBinding}`).toBe(
        command.defaultBinding
      )
    }
  })

  test('reports every owner from the full registry, including unavailable commands', () => {
    const conflicts = findBindingConflicts(COMMANDS, {}, 'window.toggle-pin', 'Shift+F')
    expect(conflicts.map((entry) => entry.id)).toEqual(['run.finish', 'review.finish'])
  })

  test('rebinding Enter and Escape discloses every scoped owner', () => {
    const enterOwners = findBindingConflicts(COMMANDS, {}, 'window.toggle-pin', 'Enter')
    const escapeOwners = findBindingConflicts(COMMANDS, {}, 'window.toggle-pin', 'Escape')

    expect(enterOwners.map((entry) => entry.id)).toContain('find.next')
    expect(enterOwners.map((entry) => entry.id)).toContain('palette.run')
    expect(escapeOwners.map((entry) => entry.id)).toEqual(['app.close-back'])
  })

  test('a digit reports every owner of a digit-range binding', () => {
    const conflicts = findBindingConflicts(COMMANDS, {}, 'window.toggle-pin', '3')

    const owners = conflicts.map((entry) => entry.id)
    expect(owners).not.toContain('roadmap.trees')
    for (const ranged of COMMANDS.filter((entry) => entry.defaultBinding === '1–9')) {
      expect(owners).toContain(ranged.id)
    }
  })
})

function eventForChord(chord: string): KeyboardEvent {
  const parts = chord.split('+')
  const keyPart = parts.at(-1)!
  const key =
    keyPart === 'Space'
      ? ' '
      : keyPart === '?'
        ? '?'
        : keyPart.length === 1 && /[A-Z]/.test(keyPart)
          ? parts.includes('Shift')
            ? keyPart
            : keyPart.toLowerCase()
          : keyPart
  const punctuationCodes: Record<string, string> = {
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    '?': 'Slash'
  }
  return {
    key,
    code: punctuationCodes[keyPart] ?? (keyPart.length === 1 ? `Key${keyPart}` : keyPart),
    metaKey: parts.includes('Mod'),
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift') || keyPart === '?'
  } as KeyboardEvent
}
