import { describe, expect, test } from 'vitest'
import { ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION, templateVersion } from '../templates'

describe('root contract — light requests and reports (T9, ADR-0011)', () => {
  test('ships the current contract marker', () => {
    expect(ROOT_TEMPLATE_VERSION).toBe(23)
    expect(templateVersion(ROOT_AGENTS_MD)).toBe(23)
  })

  test('states what the app does with git: pull on request, a .gitignore, never a commit', () => {
    expect(ROOT_AGENTS_MD).not.toMatch(/never\s+runs\s+git/)
    expect(ROOT_AGENTS_MD).toContain('never commits')
    expect(ROOT_AGENTS_MD).toContain('`git pull --ff-only`')
    expect(ROOT_AGENTS_MD).toContain('`.gitignore`')
  })

  test('documents mode and the carried-detail rule', () => {
    const carriedDetail = ROOT_AGENTS_MD.slice(
      ROOT_AGENTS_MD.indexOf('### Carried detail'),
      ROOT_AGENTS_MD.indexOf('### Detailed mode')
    )

    expect(ROOT_AGENTS_MD).toContain('`mode`')
    expect(ROOT_AGENTS_MD).toContain('`light`')
    expect(ROOT_AGENTS_MD).toContain('`detailed`')
    expect(ROOT_AGENTS_MD).toContain('mode: light')
    expect(ROOT_AGENTS_MD).toContain('collapsed behind `▸ Steps`')
    expect(carriedDetail).toContain(
      'each check body is a single paragraph — soft wrapping is fine, a blank line is not, and no list bullets'
    )
    expect(carriedDetail).toMatch(/Also worth checking.*trailing punctuation or a parenthetical/is)
    expect(carriedDetail).toMatch(/heading that begins with.*ordinary check/is)
    expect(carriedDetail).toMatch(/id.*collide.*parked convention/is)
  })

  test('documents parked-item read-back after test now', () => {
    const parkedSection = ROOT_AGENTS_MD.slice(
      ROOT_AGENTS_MD.indexOf('### Park the rest'),
      ROOT_AGENTS_MD.indexOf('### Worked example')
    )

    expect(ROOT_AGENTS_MD).toContain('`also-<slug>`')
    expect(ROOT_AGENTS_MD).toContain('test now')
    expect(parkedSection).toMatch(/report item.*parked section.*chose to poke/is)
    expect(parkedSection).not.toMatch(/An `also-` id in report `items\[\]` means/i)
  })

  test('documents the parked heading as a reserved opening phrase, loosely recognised, and last', () => {
    expect(ROOT_AGENTS_MD).toMatch(/reserved name/i)
    expect(ROOT_AGENTS_MD).toMatch(/reserved opening phrase/i)
    expect(ROOT_AGENTS_MD).toMatch(/recognised loosely/i)
    expect(ROOT_AGENTS_MD).toMatch(/trailing punctuation or a parenthetical/i)
    expect(ROOT_AGENTS_MD).toMatch(/do not begin any check heading with it/i)
    expect(ROOT_AGENTS_MD).toMatch(/heading that begins with.*ordinary check/is)
    expect(ROOT_AGENTS_MD).toMatch(/id.*collide.*parked convention/is)
    expect(ROOT_AGENTS_MD).toMatch(/keep.*Also worth checking.*last section/is)
    expect(ROOT_AGENTS_MD).toMatch(/moving.*section.*ids/is)
  })

  test('documents observations with the file-each-separately instruction', () => {
    expect(ROOT_AGENTS_MD).toContain('observations')
    expect(ROOT_AGENTS_MD).toContain('observationSeq')
    expect(ROOT_AGENTS_MD).toContain('File each one separately')
    expect(ROOT_AGENTS_MD).toMatch(/bug.*thread entry.*backlog item/s)
    expect(ROOT_AGENTS_MD).toContain('unfiled observations')
  })

  test('includes a worked light report with separate observation records', () => {
    const section = ROOT_AGENTS_MD.slice(ROOT_AGENTS_MD.indexOf('### Light reports'))
    const fence = section.match(/```json\n([\s\S]*?)```/)
    expect(fence).not.toBeNull()
    const report = JSON.parse(fence![1])
    expect(report.mode).toBe('light')
    expect(report.items).toHaveLength(2)
    expect(report.observations).toEqual([
      {
        id: 'obs-1',
        text: 'The export dialog felt slow to open the first time.',
        screenshots: []
      }
    ])
    expect(report.observationSeq).toBe(1)
  })
})
