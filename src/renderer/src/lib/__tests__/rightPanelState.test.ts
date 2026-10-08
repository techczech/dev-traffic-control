import { describe, expect, test } from 'vitest'
import { panelForSurface, setPanelForSurface, togglePanelForSurface } from '../rightPanelState'

describe('shared right-hand slot', () => {
  test('opening inspector replaces the ledger on one surface without changing another', () => {
    const initial = { 'run:/one.md': 'ledger', 'thread:alpha': 'inspector' } as const
    const next = setPanelForSurface(initial, 'run:/one.md', 'inspector')

    expect(panelForSurface(next, 'run:/one.md')).toBe('inspector')
    expect(panelForSurface(next, 'thread:alpha')).toBe('inspector')
  })

  test('each surface remembers its last persisted panel and toggle closes only that surface', () => {
    const initial = { 'run:/one.md': 'inspector', 'run:/two.md': 'ledger' } as const
    const closed = togglePanelForSurface(initial, 'run:/one.md', 'inspector')

    expect(panelForSurface(closed, 'run:/one.md')).toBe('closed')
    expect(panelForSurface(closed, 'run:/two.md')).toBe('ledger')
    expect(
      panelForSurface(togglePanelForSurface(closed, 'run:/one.md', 'inspector'), 'run:/one.md')
    ).toBe('inspector')
  })
})
