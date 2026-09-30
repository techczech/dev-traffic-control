import { describe, expect, test } from 'vitest'
import { ROOT_AGENTS_MD, templateVersion } from '../templates'

describe('root contract — release records', () => {
  test('documents the reserved folder, living ledger, states and answers sidecar', () => {
    expect(templateVersion('<!-- dev-traffic-control template v10 -->')).toBe(10)
    expect(ROOT_AGENTS_MD).toContain('releases/<version>.md')
    expect(ROOT_AGENTS_MD).toContain('releases/<version>.answers.json')
    expect(ROOT_AGENTS_MD).toMatch(/release record.*living ledger/is)
    expect(ROOT_AGENTS_MD).toMatch(/edited in place/is)
    expect(ROOT_AGENTS_MD).toContain('notstarted')
    expect(ROOT_AGENTS_MD).toContain('building')
    expect(ROOT_AGENTS_MD).toContain('built')
    expect(ROOT_AGENTS_MD).toContain('you')
    expect(ROOT_AGENTS_MD).toMatch(/`done`.*derived/is)
  })

  test('contains one parseable worked release-record example', () => {
    const section = ROOT_AGENTS_MD.slice(ROOT_AGENTS_MD.indexOf('## Release records'))
    const fence = section.match(/```markdown\n([\s\S]*?)```/)

    expect(fence).not.toBeNull()
    expect(fence![1]).toContain('app: Example App')
    expect(fence![1]).toContain('release: 0.11.0')
    expect(fence![1]).toContain('repo: example-app')
    expect(fence![1]).toContain('## Export a draft as a PDF')
  })

  test('ticket 25: documents since: beside state: and the screenshots on an answer', () => {
    const section = ROOT_AGENTS_MD.slice(
      ROOT_AGENTS_MD.indexOf('## Release records'),
      ROOT_AGENTS_MD.indexOf('## Roadmap pool')
    )
    expect(section).toMatch(/`since: YYYY-MM-DD`.*current `state:`/s)
    expect(section).toMatch(/Set it whenever you change `state:`/)
    expect(section).toContain('since: 2026-01-15')
    expect(section).toContain('`screenshots`')
    expect(section).toContain('releases/<version>.shots/<feature-id>-<n>.png')
    expect(section).toMatch(/open every picture its `screenshots` names/)
    expect(ROOT_AGENTS_MD).toContain('<version>.shots/')
  })
})
