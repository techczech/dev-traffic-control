import { describe, expect, test, vi } from 'vitest'
import type { SerializableRun } from '../../../../shared/ipc'
import { ALL_PROJECTS } from '../../../../shared/windowScope'
import { followRecordExit, recordExit } from '../recordExit'

function run(path: string, project: string): SerializableRun {
  return {
    request: { path },
    report: null,
    status: 'waiting',
    project,
    round: null
  } as unknown as SerializableRun
}

const SNAPSHOT = {
  runs: [run('/qa/windmill/2026-07-27-light.md', 'windmill')]
}

describe('recordExit', () => {
  test('the snapshot names the record’s project, and that project home is the exit', () => {
    expect(recordExit('/qa/windmill/2026-07-27-light.md', SNAPSHOT, ALL_PROJECTS)).toEqual({
      kind: 'home',
      project: 'windmill'
    })
  })

  test('a record the snapshot has not caught up with falls to the window’s project', () => {
    expect(
      recordExit('/qa/windmill/2026-07-27-new.md', SNAPSHOT, {
        kind: 'project',
        slug: 'example-app'
      })
    ).toEqual({ kind: 'home', project: 'example-app' })
    expect(
      recordExit('/qa/windmill/2026-07-27-new.md', null, { kind: 'project', slug: 'example-app' })
    ).toEqual({ kind: 'home', project: 'example-app' })
  })

  test('only a window that knows no project exits to the dashboard', () => {
    expect(recordExit('/qa/windmill/2026-07-27-new.md', SNAPSHOT, ALL_PROJECTS)).toEqual({
      kind: 'dashboard'
    })
    expect(recordExit('/qa/windmill/2026-07-27-new.md', null, ALL_PROJECTS)).toEqual({
      kind: 'dashboard'
    })
    expect(recordExit('/qa/windmill/2026-07-27-new.md', null, undefined)).toEqual({
      kind: 'dashboard'
    })
  })
})

// The exit is
// the project home, reached the one way "show me this project" always is.
describe('followRecordExit', () => {
  test('a project exit opens that project’s home and navigates nowhere else', () => {
    const nav = { openProject: vi.fn(), navigate: vi.fn() }
    followRecordExit({ kind: 'home', project: 'windmill' }, nav)
    expect(nav.openProject).toHaveBeenCalledWith('windmill')
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  test('the dashboard exit is a plain navigation', () => {
    const nav = { openProject: vi.fn(), navigate: vi.fn() }
    followRecordExit({ kind: 'dashboard' }, nav)
    expect(nav.navigate).toHaveBeenCalledWith({ kind: 'dashboard' })
    expect(nav.openProject).not.toHaveBeenCalled()
  })
})
