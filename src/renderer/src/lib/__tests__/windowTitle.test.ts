import { describe, expect, test } from 'vitest'
import { shortVersion, windowTitle } from '../windowTitle'
import type { QaSnapshot } from '../../../../shared/ipc'
import type { View } from '../../state/app'

/**
 * Dominik, 2026-09-13, on the first build where links opened windows: "app
 * window should show the name of the project and what else is open e.g.
 * DevTrafficControl - Link - Feedback". Every window was titled "Dev Traffic
 * Control", so the Window menu and Mission Control could not tell them apart —
 * which matters precisely because links make windows accumulate.
 */

const snapshot = {
  root: '/records',
  runs: [
    {
      request: {
        path: '/records/dev-traffic-control/2026-09-13-a.md',
        title: 'The link that brought you here'
      }
    }
  ],
  notes: [{ path: '/records/dev-traffic-control/note.md', title: 'A note' }],
  releases: [
    {
      kind: 'recorded',
      project: 'wordforge-desktop',
      record: { app: 'WordForge' }
    }
  ]
} as unknown as QaSnapshot

const dashboard = { kind: 'dashboard' } as View

describe('the window title says what this window is holding', () => {
  test('names the app, the project and the surface', () => {
    const title = windowTitle(
      { kind: 'project', slug: 'wordforge-desktop' },
      dashboard,
      snapshot,
      false
    )

    expect(title).toBe('Dev Traffic Control — WordForge — Project Dash')
  })

  test('names the record when one is open, not the view kind', () => {
    const view = { kind: 'runner', path: '/records/dev-traffic-control/2026-09-13-a.md' } as View

    // The app's own project is named after the app, so it is not repeated —
    // otherwise this reads "Dev Traffic Control — Dev Traffic Control — …".
    expect(
      windowTitle({ kind: 'project', slug: 'dev-traffic-control' }, view, snapshot, false)
    ).toBe('Dev Traffic Control — The link that brought you here')
  })

  test('All projects is named, never left blank', () => {
    expect(windowTitle({ kind: 'all' }, dashboard, snapshot, false)).toBe(
      'Dev Traffic Control — All projects — DTC Dash'
    )
  })

  test('the front page says so, because no project has been chosen yet', () => {
    expect(windowTitle({ kind: 'all' }, dashboard, snapshot, true)).toBe(
      'Dev Traffic Control — Projects'
    )
  })

  test('two windows on different records get different titles', () => {
    const a = windowTitle(
      { kind: 'project', slug: 'dev-traffic-control' },
      { kind: 'runner', path: '/records/dev-traffic-control/2026-09-13-a.md' } as View,
      snapshot,
      false
    )
    const b = windowTitle(
      { kind: 'project', slug: 'wordforge-desktop' },
      dashboard,
      snapshot,
      false
    )

    expect(a).not.toBe(b)
  })
})

describe('the build marker is short enough for a footer', () => {
  test('drops the v and abbreviates alpha', () => {
    expect(shortVersion('0.21.0-alpha.4')).toBe('0.21.0-a.4')
  })

  test('leaves a plain release alone', () => {
    expect(shortVersion('0.21.0')).toBe('0.21.0')
  })
})
