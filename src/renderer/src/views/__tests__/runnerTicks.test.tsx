import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ItemTicks } from '../../../../shared/ipc'
import type { QaReport, QaRequest, ReportItem } from '../../../../main/qa/types'
import { openRun as openRunFromDisk, save as saveToDisk } from '../../../../main/runnerIo'
import { reportPathFor } from '../../../../main/qa/report'
import { TicksStore } from '../../../../main/ticks'

/**
 * Ticking by click and by keyboard, plus the invariant with real consequences for a collecting
 * agent: a tick is a pencil mark that never reaches report.json.
 */

const app = vi.hoisted(() => ({
  helpOpen: false,
  switcherOpen: false,
  navigate: vi.fn(),
  back: vi.fn(),
  showToast: vi.fn(),
  snapshot: null,
  runnerMode: 'focus' as 'focus' | 'list',
  setRunnerMode: vi.fn()
}))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { Runner } from '../Runner'

const PATH = '/qa/dev-traffic-control/2026-01-20-steps-and-lists-0.2.0.md'
const STAMP = '2026-07-20T11:00:00.000Z'

function request(overrides: Partial<QaRequest> = {}): QaRequest {
  return {
    id: 'steps-and-lists-020',
    title: 'Steps and Expected lists',
    app: 'Dev Traffic Control',
    version: '0.2.0',
    labels: { gate: 'alpha', kind: 'gate' },
    mode: 'test',
    items: [
      {
        id: 'mark-click',
        title: 'Mark a step by clicking',
        steps: ['Open this request in the Runner', 'Click the small circle on this bullet'],
        expected: ['The circle fills with a teal tick', 'Nothing else happens'],
        notes: []
      }
    ],
    parked: [],
    degraded: false,
    raw: '',
    path: PATH,
    ...overrides
  }
}

function reportItem(status: ReportItem['status'] = 'unanswered'): ReportItem {
  return {
    id: 'mark-click',
    title: 'Mark a step by clicking',
    status,
    comment: '',
    flagged: [],
    quotes: [],
    screenshots: []
  }
}

function report(overrides: Partial<QaReport> = {}): QaReport {
  return {
    id: 'steps-and-lists-020',
    title: 'Steps and Expected lists',
    startedAt: STAMP,
    noteFiles: [],
    items: [reportItem()],
    ...overrides
  }
}

function installBridge(overrides: Partial<Window['qa']> = {}): {
  saveReport: ReturnType<typeof vi.fn>
  setItemTicks: ReturnType<typeof vi.fn>
  getTicks: ReturnType<typeof vi.fn>
} {
  const bridge = {
    openRun: vi.fn(async () => ({ request: request(), report: report(), exists: true })),
    getTicks: vi.fn(async () => ({})),
    setItemTicks: vi.fn(async () => {}),
    saveReport: vi.fn(async () => ({ ok: true as const, savedAt: STAMP })),
    finishRun: vi.fn(async (_p: string, value: QaReport) => ({
      ok: true as const,
      report: { ...value, completedAt: STAMP }
    })),
    reopenRun: vi.fn(),
    addShot: vi.fn(),
    readShot: vi.fn(),
    ...overrides
  } as unknown as Window['qa']
  Object.defineProperty(window, 'qa', { configurable: true, writable: true, value: bridge })
  return {
    saveReport: bridge.saveReport as ReturnType<typeof vi.fn>,
    setItemTicks: bridge.setItemTicks as ReturnType<typeof vi.fn>,
    getTicks: bridge.getTicks as ReturnType<typeof vi.fn>
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/**
 * Press a key the way a browser does, so the assertion can read whether the
 * handler cancelled the default action — which is what "the page never
 * scrolls" means for Space.
 */
function pressKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init
  })
  act(() => {
    document.body.dispatchEvent(event)
  })
  return event
}

/** The real stylesheet, so a computed style can answer "does it dim/fill". */
let styleEl: HTMLStyleElement | null = null
function loadAppStylesheet(): void {
  const css = readFileSync(path.resolve(__dirname, '../../assets/main.css'), 'utf8').replace(
    /@import\s+'tailwindcss';/,
    ''
  )
  styleEl = document.createElement('style')
  styleEl.textContent = css
  document.head.append(styleEl)
}

function tickDot(label: string): HTMLButtonElement {
  const dot = screen.getByRole('button', { name: new RegExp(`^Tick ${label}`) })
  return dot as HTMLButtonElement
}

function ticked(label: string): boolean {
  return tickDot(label).getAttribute('aria-pressed') === 'true'
}

beforeEach(() => {
  app.helpOpen = false
  app.switcherOpen = false
  app.navigate.mockReset()
  app.back.mockReset()
  app.showToast.mockReset()
  app.runnerMode = 'focus'
  app.setRunnerMode.mockReset()

  class TestResizeObserver {
    observe(): void {
      return
    }

    disconnect(): void {
      return
    }

    unobserve(): void {
      return
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  styleEl?.remove()
  styleEl = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('mark-click — clicking the circle at the start of a bullet', () => {
  test('fills the circle and dims the bullet under the real stylesheet', async () => {
    loadAppStylesheet()
    installBridge()
    const rendered = render(<Runner path={PATH} />)
    await settle()

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()
    expect(accent).toMatch(/^#[0-9a-f]{6}$/i)
    expect(muted).not.toBe(accent)

    const dot = tickDot('step 1')
    const bulletText = rendered.container.querySelector('.steps li .btxt') as HTMLElement
    expect(getComputedStyle(dot).getPropertyValue('background')).toBe('transparent')
    expect(dot.querySelector('svg')).toBeNull()
    const plainColour = getComputedStyle(bulletText).color

    fireEvent.click(dot)

    // Filled: the accent background arrives and the tick glyph is drawn.
    expect(getComputedStyle(tickDot('step 1')).getPropertyValue('background')).toBe('var(--accent)')
    expect(tickDot('step 1').querySelector('svg')).not.toBeNull()
    expect(ticked('step 1')).toBe(true)
    // Dimmed: the ticked bullet's own text colour changes to the muted token.
    const dimmedColour = getComputedStyle(bulletText).color
    expect(dimmedColour).not.toBe(plainColour)
    expect(dimmedColour).toBe('var(--muted)')
  })

  test('changes nothing else — no flag, no comment focus, no verdict, no report write', async () => {
    const { saveReport, setItemTicks } = installBridge()
    const rendered = render(<Runner path={PATH} />)
    await settle()

    const expectedBullet = rendered.container.querySelector('.expected li.exf') as HTMLElement
    expect(expectedBullet.getAttribute('aria-pressed')).toBe('false')

    // The circle inside the Expected bullet is nested in the bullet's own flag
    // toggle — the click must reach the tick and stop there.
    fireEvent.click(tickDot('expected bullet 1'))

    expect(ticked('expected bullet 1')).toBe(true)
    expect(setItemTicks).toHaveBeenCalledTimes(1)
    expect(setItemTicks.mock.calls[0][2]).toEqual({ steps: [], expected: [0] })
    // No flag on the bullet, and no flag comment box in the tree.
    expect(expectedBullet.getAttribute('aria-pressed')).toBe('false')
    expect(rendered.container.querySelector('[data-flag-comment]')).toBeNull()
    // No verdict.
    for (const name of ['Pass', 'Partial pass', 'Fail', 'Skip']) {
      expect(
        screen.getByRole('button', { name: new RegExp(name) }).getAttribute('aria-pressed')
      ).toBe('false')
    }
    // Focus never moved into a text box.
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA')
    // And the report was never even marked dirty: unmount flushes nothing.
    rendered.unmount()
    await settle()
    expect(saveReport).not.toHaveBeenCalled()
  })
})

describe('mark-space — the keyboard walk', () => {
  test('Space ticks the next unticked bullet in document order and cancels the scroll', async () => {
    const { setItemTicks } = installBridge()
    render(<Runner path={PATH} />)
    await settle()

    const first = pressKey(' ')
    expect(first.defaultPrevented).toBe(true)
    expect(ticked('step 1')).toBe(true)

    pressKey(' ')
    expect(ticked('step 2')).toBe(true)
    // Steps come before Expected: the third press must not reach an Expected
    // bullet until both steps are ticked.
    expect(ticked('expected bullet 1')).toBe(false)

    pressKey(' ')
    expect(ticked('expected bullet 1')).toBe(true)
    pressKey(' ')
    expect(ticked('expected bullet 2')).toBe(true)

    expect(setItemTicks.mock.calls.map((call) => call[2] as ItemTicks)).toEqual([
      { steps: [0], expected: [] },
      { steps: [0, 1], expected: [] },
      { steps: [0, 1], expected: [0] },
      { steps: [0, 1], expected: [0, 1] }
    ])
  })

  test('Shift+Space unticks the most recently ticked bullet, also without scrolling', async () => {
    const { setItemTicks } = installBridge()
    render(<Runner path={PATH} />)
    await settle()

    pressKey(' ')
    pressKey(' ')
    pressKey(' ') // steps 1, 2 then expected 1
    expect(ticked('expected bullet 1')).toBe(true)

    const unticking = pressKey(' ', { shiftKey: true })
    expect(unticking.defaultPrevented).toBe(true)
    expect(ticked('expected bullet 1')).toBe(false)
    expect(ticked('step 2')).toBe(true)

    pressKey(' ', { shiftKey: true })
    expect(ticked('step 2')).toBe(false)
    expect(ticked('step 1')).toBe(true)

    expect(setItemTicks.mock.calls.map((call) => call[2] as ItemTicks)).toEqual([
      { steps: [0], expected: [] },
      { steps: [0, 1], expected: [] },
      { steps: [0, 1], expected: [0] },
      { steps: [0, 1], expected: [] },
      { steps: [0], expected: [] }
    ])
  })

  test('the most recently ticked bullet is the clicked one, not the last in the list', async () => {
    installBridge()
    render(<Runner path={PATH} />)
    await settle()

    pressKey(' ') // step 1
    fireEvent.click(tickDot('expected bullet 2')) // out of order
    pressKey(' ', { shiftKey: true })

    expect(ticked('expected bullet 2')).toBe(false)
    expect(ticked('step 1')).toBe(true)
  })
})

describe('mark-restart — ticks leave no trace in report.json', () => {
  test('a real disk round trip puts ticks in ticks.json and nothing in the report', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qa-ticks-report-'))
    const requestPath = path.join(dir, '2026-07-20-progress-marks.md')
    // Deliberately neutral wording: no title or id in this fixture contains
    // "tick", "steps" or "expected", so the string search over report.json
    // below can only match a real leak, never the request's own prose.
    await writeFile(
      requestPath,
      `---
id: progress-marks
title: Progress marks on a request
---
## Circle at the start of a bullet {#circle}

**Steps**
- Open this request in the Runner
- Click the small circle on this bullet

**Expected**
- The circle fills with a teal mark
- Nothing else happens
`
    )
    const ticksFile = path.join(dir, 'ticks.json')
    const store = new TicksStore(ticksFile)
    // Every disk write is awaited explicitly below — never inferred from a
    // sibling promise settling, which would make the file reads racy.
    const reportWrites: Promise<unknown>[] = []

    installBridge({
      openRun: vi.fn(async () => openRunFromDisk(requestPath, () => STAMP)),
      getTicks: vi.fn(async (base: string) => store.get(base)),
      setItemTicks: vi.fn(async (base: string, itemId: string, item: ItemTicks) => {
        store.setItem(base, itemId, item)
        await store.pendingWrite
      }),
      saveReport: vi.fn(async (_p: string, value: QaReport) => {
        const write = saveToDisk(requestPath, value)
        reportWrites.push(write)
        return { ok: true as const, ...(await write) }
      })
    })

    const rendered = render(<Runner path={requestPath} />)
    // Opening reads the request and any report off real disk — more than one
    // microtask turn, so wait for the card rather than settling once.
    await screen.findByRole('button', { name: /^Tick step 1/ })

    fireEvent.click(tickDot('step 1'))
    pressKey(' ') // step 2
    pressKey(' ') // expected bullet 1
    await settle()
    // A verdict forces a real report write, so the report file exists and its
    // silence about ticks is a fact rather than a missing file.
    pressKey('p')
    rendered.unmount()
    await settle()
    await store.pendingWrite
    expect(reportWrites.length).toBeGreaterThan(0)
    await Promise.all(reportWrites)

    const reportText = await readFile(reportPathFor(requestPath), 'utf8')
    expect(reportText).not.toMatch(/tick/i)
    expect(reportText).not.toMatch(/steps/i)
    expect(reportText).not.toMatch(/expected/i)
    const parsed = JSON.parse(reportText) as QaReport
    expect(parsed.items).toEqual([
      {
        id: 'circle',
        title: 'Circle at the start of a bullet',
        status: 'pass',
        comment: '',
        flagged: [],
        quotes: [],
        screenshots: []
      }
    ])
    // No extra channel smuggled a tick in under another name.
    expect(Object.keys(parsed.items[0]).sort()).toEqual([
      'comment',
      'flagged',
      'id',
      'quotes',
      'screenshots',
      'status',
      'title'
    ])
    expect(Object.keys(parsed).sort()).toEqual(['id', 'items', 'noteFiles', 'startedAt', 'title'])

    // Liveness: the ticks really happened and landed in their own store, so the
    // report's silence above cannot be the silence of a dead tick path.
    expect(JSON.parse(await readFile(ticksFile, 'utf8'))).toEqual({
      [requestPath.replace(/^\//, '')]: {
        circle: { steps: [0, 1], expected: [0] }
      }
    })
  })
})
