import { describe, expect, test, vi } from 'vitest'
import { COMMANDS, availableCommands, runCommand } from '../registry'
import type { CommandRuntime } from '../registry'

function runtime(enabled: readonly string[] = []): CommandRuntime {
  const handlers = new Map(enabled.map((id) => [id, vi.fn()]))
  return {
    canInvoke: (id) => handlers.has(id),
    invoke: vi.fn((id) => handlers.get(id)?.()),
    contextLabel: null
  }
}

describe('command registry', () => {
  test('every command has the complete registry contract', () => {
    expect(COMMANDS.length).toBeGreaterThan(0)
    for (const command of COMMANDS) {
      expect(command.id).toMatch(/^[a-z][a-z0-9.-]+$/)
      expect(command.title.length).toBeGreaterThan(0)
      expect(command.section.length).toBeGreaterThan(0)
      expect(Object.prototype.hasOwnProperty.call(command, 'defaultBinding')).toBe(true)
      expect(typeof command.when).toBe('function')
      expect(typeof command.handler).toBe('function')
    }
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length)
  })

  test('when predicates gate the palette to commands with live handlers', () => {
    const current = runtime(['app.cheat-sheet', 'window.toggle-pin'])
    expect(availableCommands(current).map((command) => command.id)).toEqual([
      'app.cheat-sheet',
      'window.toggle-pin'
    ])
  })

  test('copy link to this project appears in the palette when a project is in scope', () => {
    const entries = availableCommands(runtime(['nav.copy-project-link']))
    expect(entries.map(({ title }) => title)).toEqual(['Copy link to this project'])
  })

  test('a registry handler invokes the current view implementation', () => {
    const current = runtime(['app.cheat-sheet'])
    expect(runCommand('app.cheat-sheet', current)).toBe(true)
    expect(current.invoke).toHaveBeenCalledWith('app.cheat-sheet', undefined)
    expect(runCommand('window.toggle-pin', current)).toBe(false)
  })

  test('the adopted estate bindings are reserved to their command surfaces', () => {
    const adopted = new Map([
      ['app.command-palette', 'Mod+Shift+P'],
      ['app.navigation-switcher', 'Mod+Shift+K'],
      ['app.contextual-actions', 'Mod+K'],
      ['app.inspector', 'Mod+P'],
      ['app.find-document', 'Mod+F'],
      ['app.search-everything', 'Mod+Shift+F'],
      ['app.settings', 'Mod+,'],
      ['app.cheat-sheet', 'Mod+/'],
      ['window.toggle-pin', 'Mod+Alt+P']
    ])

    for (const [id, binding] of adopted) {
      expect(COMMANDS.find((command) => command.id === id)?.defaultBinding).toBe(binding)
      expect(
        COMMANDS.filter(
          (command) =>
            command.id !== id &&
            [command.defaultBinding, ...(command.alternateBindings ?? [])].includes(binding)
        )
      ).toEqual([])
    }
  })

  test('request reading text-size commands use the platform zoom conventions without conflicts', () => {
    const expected = new Map([
      ['reading.text-size-increase', 'Mod+='],
      ['reading.text-size-decrease', 'Mod+-'],
      ['reading.text-size-reset', 'Mod+0']
    ])

    for (const [id, binding] of expected) {
      const owner = COMMANDS.find((command) => command.id === id)
      expect(owner?.defaultBinding).toBe(binding)
      expect(
        COMMANDS.filter(
          (command) =>
            command.id !== id &&
            [command.defaultBinding, ...(command.alternateBindings ?? [])].includes(binding)
        )
      ).toEqual([])
    }
  })

  test('the six top-level surfaces are registered in Overview-first bar order', () => {
    const surfaces = [
      ['nav.dashboard', 'Go to Overview', 'Mod+1'],
      ['nav.inbox', 'Go to Inbox', 'Mod+2'],
      ['nav.specs', 'Go to Specs', 'Mod+3'],
      ['nav.releases', 'Go to Releases', 'Mod+4'],
      ['nav.roadmap', 'Go to Roadmap', 'Mod+5'],
      ['nav.handoffs', 'Go to Handoffs', 'Mod+6']
    ]

    const surfaceCommands = COMMANDS.filter((command) =>
      surfaces.some(([id]) => id === command.id)
    ).map(({ id, title, defaultBinding }) => [id, title, defaultBinding])
    expect(surfaceCommands).toEqual(surfaces)

    expect(COMMANDS.map((command) => command.id)).not.toEqual(
      expect.arrayContaining(['roadmap.dashboard', 'roadmap.ledger', 'roadmap.trees'])
    )
  })

  test('the Releases project sidebar controls are registered', () => {
    expect(
      COMMANDS.filter((command) =>
        [
          'release.show-board',
          'release.project-previous',
          'release.project-next',
          'release.toggle-version-layout',
          'release.toggle-needs-you-group',
          'release.toggle-in-flight-group',
          'release.toggle-nothing-declared-group'
        ].includes(command.id)
      ).map((command) => command.id)
    ).toEqual([
      'release.show-board',
      'release.project-previous',
      'release.project-next',
      'release.toggle-version-layout',
      'release.toggle-needs-you-group',
      'release.toggle-in-flight-group',
      'release.toggle-nothing-declared-group'
    ])
  })

  test('the Roadmap project sidebar controls are registered without binding collisions', () => {
    const expected = new Map([
      ['roadmap.project-previous', 'Ctrl+Alt+ArrowUp'],
      ['roadmap.project-next', 'Ctrl+Alt+ArrowDown'],
      ['roadmap.toggle-with-ideas-group', 'Ctrl+Alt+4'],
      ['roadmap.toggle-nothing-in-pool-group', 'Ctrl+Alt+5']
    ])

    for (const [id, binding] of expected) {
      const owner = COMMANDS.find((command) => command.id === id)
      expect(owner?.defaultBinding).toBe(binding)
      expect(
        COMMANDS.filter(
          (command) =>
            command.id !== id &&
            [command.defaultBinding, ...(command.alternateBindings ?? [])].includes(binding)
        )
      ).toEqual([])
    }
  })

  test('the Handoffs grouping and project controls are registered', () => {
    expect(
      COMMANDS.filter((command) =>
        ['handoff.toggle-grouping', 'handoff.filter-project'].includes(command.id)
      ).map(({ id, title, defaultBinding }) => ({ id, title, defaultBinding }))
    ).toEqual([
      {
        id: 'handoff.toggle-grouping',
        title: 'Group handoffs by project or list newest first',
        defaultBinding: 'Alt+G'
      },
      {
        id: 'handoff.filter-project',
        title: 'Filter handoffs by project',
        defaultBinding: 'Alt+5'
      }
    ])
  })

  test('New Window uses the unreserved and unconflicted platform default', () => {
    const command = COMMANDS.find((entry) => entry.id === 'app.new-window')
    expect(command?.title).toBe('New Window')
    expect(command?.defaultBinding).toBe('Mod+N')
    expect(
      COMMANDS.filter(
        (entry) =>
          entry.id !== 'app.new-window' &&
          [entry.defaultBinding, ...(entry.alternateBindings ?? [])].includes('Mod+N')
      )
    ).toEqual([])
  })

  test('Reset window position has a registered recovery chord', () => {
    const command = COMMANDS.find((entry) => entry.id === 'window.reset-position')
    expect(command?.title).toBe('Reset window position')
    expect(command?.defaultBinding).toBe('Ctrl+Alt+R')
  })

  test('Copy collect prompt is available only when a finished run registers its handler', () => {
    expect(availableCommands(runtime([])).map((command) => command.id)).not.toContain(
      'run.copy-collect-prompt'
    )
    expect(
      availableCommands(runtime(['run.copy-collect-prompt'])).map((command) => command.id)
    ).toContain('run.copy-collect-prompt')
    expect(COMMANDS.find((entry) => entry.id === 'run.copy-collect-prompt')?.title).toBe(
      'Copy collect prompt'
    )
  })

  test('every registry entry has a production scope or command-surface reference', () => {
    const modules = import.meta.glob('../../**/*.{ts,tsx}', {
      eager: true,
      query: '?raw',
      import: 'default'
    }) as Record<string, string>
    const productionSource = Object.entries(modules)
      .filter(([path]) => !path.includes('/commands/registry.ts'))
      .filter(([path]) => !path.includes('/__tests__/'))
      .map(([, source]) => source)
      .join('\n')

    const unreferenced = COMMANDS.filter(
      (command) =>
        !productionSource.includes(`'${command.id}'`) &&
        !productionSource.includes(`"${command.id}"`)
    ).map((command) => command.id)
    expect(unreferenced).toEqual([])
  })
})
