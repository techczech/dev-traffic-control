import { describe, expect, test } from 'vitest'
import { agentStatusSentence } from '../../lib/agentStatus'

const NOW = new Date('2026-08-03T12:00:00.000Z')

describe('agent status', () => {
  test('renders a live local claim', () => {
    expect(
      agentStatusSentence(
        {
          agent: 'claude',
          machine: 'laptop',
          startedAt: '2026-08-03T11:00:00.000Z',
          heartbeatAt: '2026-08-03T11:59:52.000Z'
        },
        NOW,
        'laptop'
      )
    ).toMatch(/^Claude is watching this — last seen today \d\d:\d\d$/)
  })

  test('renders a stale local claim as not watching with its age', () => {
    expect(
      agentStatusSentence(
        {
          agent: 'claude',
          machine: 'laptop',
          startedAt: '2026-08-03T11:00:00.000Z',
          heartbeatAt: '2026-08-03T11:58:29.000Z'
        },
        NOW,
        'laptop'
      )
    ).toMatch(/^Nothing is watching this right now — last seen today \d\d:\d\d$/)
  })

  test('never treats a foreign machine as live here', () => {
    const sentence = agentStatusSentence(
      {
        agent: 'claude',
        machine: 'workstation',
        startedAt: '2026-08-03T11:00:00.000Z',
        heartbeatAt: '2026-08-03T11:59:52.000Z'
      },
      NOW,
      'laptop'
    )
    expect(sentence).not.toContain('Claude is watching this')
    expect(sentence).toContain('workstation')
  })
})
