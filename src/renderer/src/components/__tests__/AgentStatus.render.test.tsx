import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'

const app = vi.hoisted(() => ({ snapshot: null as QaSnapshot | null }))

vi.mock('../../state/app', () => ({
  useApp: () => app
}))

import { AgentStatus } from '../AgentStatus'

const NOW = '2026-08-03T12:00:00.000Z'
const PATH = '/qa/dev-traffic-control/request.md'

function snapshot(machine: string, heartbeatAt?: string, claimMachine = machine): QaSnapshot {
  return {
    root: '/qa',
    localMachine: machine,
    rootMissing: false,
    runs: [
      {
        request: {
          id: 'request',
          title: 'Request',
          labels: {},
          mode: 'test',
          items: [],
          parked: [],
          degraded: false,
          raw: '',
          path: PATH
        },
        report: null,
        status: 'waiting',
        project: 'dev-traffic-control',
        round: null,
        ...(heartbeatAt
          ? {
              watch: {
                agent: 'fable',
                machine: claimMachine,
                startedAt: '2026-08-03T11:00:00.000Z',
                heartbeatAt
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
    scannedAt: NOW
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test.each([
  ['live', snapshot('laptop', '2026-08-03T11:59:52.000Z'), 'true', 'status-progress'],
  ['stale', snapshot('laptop', '2026-08-03T11:58:29.000Z'), 'false', 'status-inactive'],
  [
    'foreign-machine',
    snapshot('laptop', '2026-08-03T11:59:52.000Z', 'workstation'),
    'false',
    'status-inactive'
  ]
])('renders the %s watch state as a first-class filled pill', (_name, value, live, tone) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  app.snapshot = value

  const rendered = render(<AgentStatus requestPath={PATH} />)

  const pill = rendered.container.querySelector<HTMLElement>('.agent-status')
  expect(pill).not.toBeNull()
  if (!pill) throw new Error('watch pill missing')
  expect(pill.dataset.live).toBe(live)
  expect(pill.classList.contains('status-chip')).toBe(true)
  expect(pill.classList.contains(tone)).toBe(true)
  expect(Boolean(pill.querySelector('.agent-status-dot'))).toBe(live === 'true')
})
