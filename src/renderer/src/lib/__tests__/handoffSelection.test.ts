import { beforeEach, describe, expect, test } from 'vitest'
import type { Handoff } from '../../../../main/qa/handoffs'
import { readHandoffGrouping, selectHandoffs, writeHandoffGrouping } from '../handoffSelection'

function handoff(
  path: string,
  project: string,
  updated: string,
  overrides: Partial<Handoff> = {}
): Handoff {
  return {
    path,
    file: path.split('/').at(-1) ?? path,
    title: path,
    domain: 'utilities',
    project,
    move: 'agent',
    state: 'live',
    updated,
    bodyMarkdown: '',
    raw: '',
    relaunchPrompt: '',
    sidecar: { pickedUpAt: null, archivedAt: null },
    history: { kind: 'never-picked-up' },
    ageDays: 0,
    stale: false,
    frontmatterMalformed: false,
    ...overrides
  }
}

const HANDOFFS = [
  handoff('alpha-new', 'alpha', '2026-08-08T10:00:00.000Z', {
    title: 'Needle: alpha agent task'
  }),
  handoff('beta-newest', 'beta', '2026-08-08T12:00:00.000Z'),
  handoff('alpha-me', 'alpha', '2026-08-08T09:00:00.000Z', { move: 'me' }),
  handoff('alpha-superseded', 'alpha', '2026-08-08T08:00:00.000Z', {
    state: 'superseded'
  }),
  handoff('alpha-old', 'alpha', '2026-08-08T07:00:00.000Z'),
  handoff('beta-old', 'beta', '2026-08-08T06:00:00.000Z')
]

describe('selectHandoffs', () => {
  test('flat sections are strictly newest first across projects', () => {
    const result = selectHandoffs(HANDOFFS, {
      grouping: 'flat',
      project: null,
      move: 'all',
      query: ''
    })

    expect(result.visible.map(({ path }) => path)).toEqual([
      'beta-newest',
      'alpha-new',
      'alpha-me',
      'alpha-superseded',
      'alpha-old',
      'beta-old'
    ])
    expect(result.sections).toEqual([{ project: null, handoffs: result.visible }])
  })

  test('project grouping never reorders handoffs within a project', () => {
    const result = selectHandoffs(HANDOFFS, {
      grouping: 'project',
      project: null,
      move: 'all',
      query: ''
    })

    expect(result.sections.map(({ project }) => project)).toEqual(['beta', 'alpha'])
    expect(
      result.sections.find(({ project }) => project === 'alpha')?.handoffs.map(({ path }) => path)
    ).toEqual(['alpha-new', 'alpha-me', 'alpha-superseded', 'alpha-old'])
  })

  test('project, move, and search predicates all narrow the visible list', () => {
    const result = selectHandoffs(HANDOFFS, {
      grouping: 'flat',
      project: 'alpha',
      move: 'agent',
      query: 'needle'
    })

    expect(result.visible.map(({ path }) => path)).toEqual(['alpha-new'])
  })

  test('move counts describe the current project before the move filter is applied', () => {
    const result = selectHandoffs(HANDOFFS, {
      grouping: 'flat',
      project: 'alpha',
      move: 'agent',
      query: ''
    })

    expect(result.counts).toEqual({ all: 4, agent: 2, me: 1, superseded: 1 })
    expect(result.projects).toEqual([
      { project: 'alpha', count: 4 },
      { project: 'beta', count: 2 }
    ])
  })
})

describe('handoff view persistence', () => {
  beforeEach(() => localStorage.clear())

  test('round-trips the grouping choice', () => {
    expect(readHandoffGrouping()).toBe('flat')
    writeHandoffGrouping('project')
    expect(readHandoffGrouping()).toBe('project')
  })
})
