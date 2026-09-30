import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaReport, QaRequest, ReportItem } from '../../../../main/qa/types'
import type { InboxState, QaSnapshot, Settings } from '../../../../shared/ipc'
import { AppProvider } from '../../state/app'
import { LightRun } from '../LightRun'

const PATH = '/qa/dev-traffic-control/request.md'
const NOW = '2026-08-03T12:00:00.000Z'
const FINISHED_AT = '2026-08-03T11:59:55.000Z'
const RECEIPTS_START_AT = '2026-08-03T00:00:00.000Z'

const item: ReportItem = {
  id: 'check-one',
  title: 'Check one',
  status: 'pass',
  comment: '',
  flagged: [],
  quotes: [],
  screenshots: []
}

const request: QaRequest = {
  id: 'request',
  title: 'Request',
  labels: {},
  mode: 'light',
  items: [
    {
      id: 'check-one',
      title: 'Check one',
      context: 'Check one.',
      steps: [],
      expected: [],
      notes: []
    }
  ],
  parked: [],
  degraded: false,
  raw: '',
  path: PATH
}

const report: QaReport = {
  id: 'request',
  title: 'Request',
  startedAt: '2026-08-03T11:50:00.000Z',
  completedAt: FINISHED_AT,
  noteFiles: [],
  mode: 'light',
  items: [item]
}

const settings: Settings = {
  qaRepoPath: '/qa',
  appearance: 'light',
  readingTextSize: 'normal',
  pinBehaviour: 'remember',
  pinned: false,
  dockBadge: true,
  runnerMode: 'focus',
  widthPreset: 'narrow',
  windowMode: 'free',
  verdictLayout: 'one',
  reviewMargin: 'auto',
  keymap: {}
}

function snapshot(options: { watching?: boolean; collected?: boolean } = {}): QaSnapshot {
  return {
    root: '/qa',
    localMachine: 'laptop',
    rootMissing: false,
    runs: [
      {
        request,
        report,
        status: 'done',
        project: 'dev-traffic-control',
        round: null,
        ...(options.watching
          ? {
              watch: {
                agent: 'fable',
                machine: 'laptop',
                startedAt: '2026-08-03T11:55:00.000Z',
                heartbeatAt: '2026-08-03T11:59:58.000Z'
              }
            }
          : {}),
        ...(options.collected
          ? {
              collection: {
                agent: 'fable',
                machine: 'laptop',
                collectedAt: NOW,
                note: 'Filed both corrections.'
              }
            }
          : {})
      }
    ],
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: [],
    pools: [],
    projects: ['dev-traffic-control'],
    scannedAt: NOW,
    receiptsStartAt: RECEIPTS_START_AT
  }
}

let pushSnapshot: ((value: QaSnapshot) => void) | null = null
let initialSnapshot: QaSnapshot

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  pushSnapshot = null
  initialSnapshot = snapshot({ watching: true })
  const bridge = {
    getSnapshot: vi.fn(async () => initialSnapshot),
    onSnapshot: vi.fn((listener: (value: QaSnapshot) => void) => {
      pushSnapshot = listener
      return vi.fn()
    }),
    getSettings: vi.fn(async () => settings),
    getViewState: vi.fn(async () => ({ rightPanels: {} })),
    setRightPanels: vi.fn(async (rightPanels) => ({ rightPanels })),
    firstRun: vi.fn(async () => false),
    getInboxState: vi.fn(async (): Promise<InboxState> => ({ seen: [], archived: [] })),
    onInboxState: vi.fn(() => vi.fn()),
    copyCollectPrompt: vi.fn(async () => {}),
    reopenRun: vi.fn(),
    saveReport: vi.fn(),
    addShot: vi.fn(),
    readShot: vi.fn(),
    getTicks: vi.fn(async () => ({})),
    setItemTicks: vi.fn(async () => {})
  } as unknown as Window['qa']
  Object.defineProperty(window, 'qa', { configurable: true, writable: true, value: bridge })

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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('shows the live waiting state, then a pushed receipt updates the open run without a remount', async () => {
  render(
    <AppProvider>
      <LightRun path={PATH} request={request} initialReport={report} />
    </AppProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(screen.getByText('Fable is watching — waiting to be picked up')).toBeTruthy()

  await act(async () => {
    pushSnapshot?.(snapshot({ watching: true, collected: true }))
  })

  expect(screen.getByText(/^Collected by Fable — (today )?\d\d:\d\d$/)).toBeTruthy()
  expect(screen.getByText('Filed both corrections.')).toBeTruthy()
  expect(screen.queryByText('Fable is watching — waiting to be picked up')).toBeNull()
})

test('shows the exact unattended instruction with the copy control adjacent', async () => {
  initialSnapshot = snapshot()
  render(
    <AppProvider>
      <LightRun path={PATH} request={request} initialReport={report} />
    </AppProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  const message = screen.getByText(
    'Nothing is watching this — copy the collect prompt to start an agent'
  )
  const state = message.closest('[data-collection-state]')
  expect(state).not.toBeNull()
  expect(state?.querySelector('button')?.textContent).toBe('Copy collect prompt')
})

test('does not make a retroactive not-collected claim before receipt tracking began', async () => {
  initialSnapshot = {
    ...snapshot(),
    receiptsStartAt: '2026-08-04T00:00:00.000Z'
  }
  render(
    <AppProvider>
      <LightRun path={PATH} request={request} initialReport={report} />
    </AppProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(
    screen.queryByText('Nothing is watching this — copy the collect prompt to start an agent')
  ).toBeNull()
  expect(screen.getByRole('button', { name: 'Copy collect prompt' })).toBeTruthy()
})
