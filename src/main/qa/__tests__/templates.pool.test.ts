import { describe, expect, test } from 'vitest'
import { ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION } from '../templates'

describe('root contract — roadmap pool', () => {
  test('documents both file shapes and the ownership split at a new template version', () => {
    expect(ROOT_TEMPLATE_VERSION).toBe(20)
    expect(ROOT_AGENTS_MD).toContain('roadmap/')
    expect(ROOT_AGENTS_MD).toContain('<id>.md')
    expect(ROOT_AGENTS_MD).toContain('order.json')
    expect(ROOT_AGENTS_MD).toMatch(/idea files.*living ledger shared by agents and the app/is)
    expect(ROOT_AGENTS_MD).toMatch(/order\.json.*app-owned/is)
    expect(ROOT_AGENTS_MD).toMatch(/preserves every other frontmatter key byte-for-byte/is)
    expect(ROOT_AGENTS_MD).toContain('candidate: 0.15.0')
    expect(ROOT_AGENTS_MD).toContain('"positions"')
    expect(ROOT_AGENTS_MD).toContain('"states"')
    expect(ROOT_AGENTS_MD).toContain('"returned"')
    expect(ROOT_AGENTS_MD).toContain('returned from')
    expect(ROOT_AGENTS_MD).toContain('"seenAt"')
  })
})
