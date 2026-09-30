import { describe, expect, test } from 'vitest'
import type { QaSnapshot } from '../../../../shared/ipc'
import { archiveOldCandidates } from '../archiveOld'

const NOW = new Date('2026-09-23T12:00:00.000Z')
const DAYS_AGO = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString()

function snapshot(): QaSnapshot {
  const run = (project: string, name: string, at: string, status = 'waiting') => ({
    project,
    status,
    request: { path: `/record/${project}/${name}.md`, date: at.slice(0, 10) },
    requestMtime: at,
    report: null
  })
  return {
    root: '/record',
    projects: ['tallyboard', 'redforge'],
    runs: [
      run('tallyboard', 'fresh', DAYS_AGO(2)),
      run('tallyboard', 'ten-days', DAYS_AGO(10)),
      run('redforge', 'forty-days', DAYS_AGO(40)),
      run('redforge', 'forty-days-done', DAYS_AGO(40), 'done')
    ],
    threads: [
      { id: 't-old', projects: ['redforge'], state: 'open', move: 'me', lastAt: DAYS_AGO(20) },
      { id: 't-agent', projects: ['redforge'], state: 'open', move: 'agent', lastAt: DAYS_AGO(20) },
      { id: 't-new', projects: ['tallyboard'], state: 'open', move: 'me', lastAt: DAYS_AGO(1) }
    ],
    handoffs: [
      {
        path: '/record/tallyboard/handoffs/old-handoff.md',
        project: 'tallyboard',
        updated: DAYS_AGO(31),
        state: 'live',
        history: { kind: 'never-picked-up' }
      },
      {
        path: '/record/tallyboard/handoffs/picked-handoff.md',
        project: 'tallyboard',
        updated: DAYS_AGO(31),
        state: 'live',
        history: { kind: 'picked-up', at: DAYS_AGO(30) }
      }
    ],
    releases: []
  } as unknown as QaSnapshot
}

describe('archive old picks what is owed and older than the age he chooses (ticket 22)', () => {
  test('each age clears a different number, older ages fewer', () => {
    const counts = [7, 14, 30].map(
      (days) => archiveOldCandidates(snapshot(), { kind: 'all' }, days, NOW).total
    )
    // 7: ten-days, forty-days, t-old, old-handoff. 14: forty-days, t-old, handoff. 30: forty-days, handoff.
    expect(counts).toEqual([4, 3, 2])
  })

  test('only owed items are candidates: not done, not the agent’s move, not picked up', () => {
    const all = archiveOldCandidates(snapshot(), { kind: 'all' }, 7, NOW)
    expect(all.requests).toEqual(['tallyboard/ten-days.md', 'redforge/forty-days.md'])
    expect(all.threads).toEqual(['t-old'])
    expect(all.handoffs).toEqual(['/record/tallyboard/handoffs/old-handoff.md'])
  })

  test('inside a project only that project clears', () => {
    const tw = archiveOldCandidates(snapshot(), { kind: 'project', slug: 'tallyboard' }, 7, NOW)
    expect(tw.requests).toEqual(['tallyboard/ten-days.md'])
    expect(tw.threads).toEqual([])
    expect(tw.handoffs).toEqual(['/record/tallyboard/handoffs/old-handoff.md'])
  })

  test('something already archived is not offered again', () => {
    const housekeeping = {
      root: '/record',
      requests: new Set(['redforge/forty-days.md']),
      threads: new Set(['t-old'])
    }
    const all = archiveOldCandidates(snapshot(), { kind: 'all' }, 7, NOW, housekeeping)
    expect(all.requests).toEqual(['tallyboard/ten-days.md'])
    expect(all.threads).toEqual([])
  })
})
