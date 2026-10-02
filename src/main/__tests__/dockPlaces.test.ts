import { describe, expect, test } from 'vitest'
import {
  dockBounds,
  DOCK_REPEAT_MS,
  dockClickStep,
  dockMenuState,
  type DockCycle,
  otherDisplay,
  placeIdFor,
  resolveDockPlace,
  type DockDisplay
} from '../dockPlaces'
import { NARROW_WIDTH } from '../windowLayout'

// Ticket 27: the dock is where the window goes.
const LAPTOP: DockDisplay = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 920 } }
const MONITOR: DockDisplay = { id: 2, workArea: { x: 1512, y: 0, width: 2560, height: 1415 } }
const TWO = [LAPTOP, MONITOR]

describe('dockBounds', () => {
  test('the right edge of this screen: sidebar width, full work-area height, flush right', () => {
    expect(dockBounds({ edge: 'right', displayId: 1 }, TWO, 1, NARROW_WIDTH)).toEqual({
      bounds: { x: 1512 - NARROW_WIDTH, y: 25, width: NARROW_WIDTH, height: 920 },
      displayId: 1
    })
  })

  test('the left edge of the other screen sits at that screen’s own origin', () => {
    expect(dockBounds({ edge: 'left', displayId: 2 }, TWO, 1, NARROW_WIDTH)).toEqual({
      bounds: { x: 1512, y: 0, width: NARROW_WIDTH, height: 1415 },
      displayId: 2
    })
  })

  test('a remembered screen that is gone falls back to the same edge of the current one', () => {
    expect(dockBounds({ edge: 'left', displayId: 2 }, [LAPTOP], 1, NARROW_WIDTH)).toEqual({
      bounds: { x: 0, y: 25, width: NARROW_WIDTH, height: 920 },
      displayId: 1
    })
  })

  test('the sidebar is never wider than the screen it docks on', () => {
    const tiny: DockDisplay = { id: 9, workArea: { x: 0, y: 0, width: 400, height: 600 } }
    expect(dockBounds({ edge: 'right', displayId: 9 }, [tiny], 9, NARROW_WIDTH).bounds).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 600
    })
  })
})

describe('this screen and the other screen', () => {
  test('the other screen is the next display, wrapping; none with one display', () => {
    expect(otherDisplay(TWO, 1)?.id).toBe(2)
    expect(otherDisplay(TWO, 2)?.id).toBe(1)
    expect(otherDisplay([LAPTOP], 1)).toBeUndefined()
  })

  test('a menu choice is remembered as an edge and a display id', () => {
    expect(resolveDockPlace('right-this', TWO, 1)).toEqual({ edge: 'right', displayId: 1 })
    expect(resolveDockPlace('left-other', TWO, 1)).toEqual({ edge: 'left', displayId: 2 })
    // Disabled in the menu with one screen; if it arrives anyway it means this screen.
    expect(resolveDockPlace('left-other', [LAPTOP], 1)).toEqual({ edge: 'left', displayId: 1 })
  })

  test('the remembered place reads from wherever the window is now', () => {
    const onMonitor = { edge: 'right' as const, displayId: 2 }
    expect(placeIdFor(onMonitor, TWO, 1)).toBe('right-other')
    expect(placeIdFor(onMonitor, TWO, 2)).toBe('right-this')
    expect(placeIdFor(onMonitor, [LAPTOP], 1)).toBe('right-this')
  })
})

describe('dockMenuState', () => {
  test('four places in the drawn order, the last-used one marked', () => {
    const menu = dockMenuState({ edge: 'left', displayId: 2 }, TWO, 1)
    expect(menu.last).toBe('left-other')
    expect(menu.places.map((place) => [place.label, place.enabled, place.current])).toEqual([
      ['Right edge · this screen', true, false],
      ['Left edge · this screen', true, false],
      ['Right edge · other screen', true, false],
      ['Left edge · other screen', true, true]
    ])
  })

  test('with one display the two other-screen places are disabled', () => {
    const menu = dockMenuState(null, [LAPTOP], 1)
    expect(menu.places.filter((place) => !place.enabled).map((place) => place.id)).toEqual([
      'right-other',
      'left-other'
    ])
    // Never docked: the right edge of this screen.
    expect(menu.last).toBe('right-this')
  })
})

// Ticket 41: "the multiple clicking of the sidebar button still does not rotate
// through positions".
describe('dockClickStep', () => {
  /** Click `count` times `gap` ms apart, applying each result to the display the window lands on. */
  function clicks(
    displays: readonly DockDisplay[],
    startId: number,
    count: number,
    gap = 1000,
    remembered: { edge: 'left' | 'right'; displayId: number } | null = null
  ): string[] {
    let cycle: DockCycle | null = null
    let place = remembered
    let currentId = startId
    const edges: string[] = []
    for (let index = 0; index < count; index += 1) {
      const step = dockClickStep(cycle, 10_000 + index * gap, place, displays, currentId)
      cycle = step.cycle
      place = step.target
      currentId = step.target.displayId
      edges.push(`${step.target.edge}-${step.target.displayId}`)
    }
    return edges
  }

  test('the first click docks at the last-used place', () => {
    expect(clicks(TWO, 1, 1, 1000, { edge: 'left', displayId: 2 })).toEqual(['left-2'])
    expect(clicks(TWO, 1, 1)).toEqual(['right-1'])
  })

  test('repeated clicks step right/this, left/this, right/other, left/other, then wrap', () => {
    expect(clicks(TWO, 1, 6)).toEqual([
      'right-1',
      'left-1',
      'right-2',
      'left-2',
      'right-1',
      'left-1'
    ])
  })

  test('the run is named from the screen it started on, though the window moves screens', () => {
    expect(clicks(TWO, 2, 3)).toEqual(['right-2', 'left-2', 'right-1'])
  })

  test('the run continues from the remembered place', () => {
    expect(clicks(TWO, 1, 3, 1000, { edge: 'left', displayId: 1 })).toEqual([
      'left-1',
      'right-2',
      'left-2'
    ])
  })

  test('with one display it alternates right and left', () => {
    expect(clicks([LAPTOP], 1, 5)).toEqual(['right-1', 'left-1', 'right-1', 'left-1', 'right-1'])
  })

  test('a click more than the repeat window after the last starts again at the last-used place', () => {
    const first = dockClickStep(null, 0, null, TWO, 1)
    const second = dockClickStep(first.cycle, DOCK_REPEAT_MS, first.target, TWO, 1)
    expect(second.target).toEqual({ edge: 'left', displayId: 1 })
    const late = dockClickStep(second.cycle, DOCK_REPEAT_MS * 2 + 1, second.target, TWO, 1)
    expect(late.target).toEqual({ edge: 'left', displayId: 1 })
    expect(late.cycle.place).toBe('left-this')
  })

  test('no cycle (any other window action ended it) docks at the last-used place', () => {
    expect(dockClickStep(null, 5, { edge: 'left', displayId: 2 }, TWO, 1).target).toEqual({
      edge: 'left',
      displayId: 2
    })
  })
})
