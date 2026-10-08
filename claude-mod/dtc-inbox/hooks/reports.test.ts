import { describe, expect, test } from 'claude-code/testing'

import { classifyReport, decisionCounts, parseJson, requestTitle, summarise, verdictCounts } from './reports'
import { detailedReport, docReviewReport, inProgressReport, lightReport } from './fixtures'

const facts = (reportText: string | null, isCollected = false, isOpened = false) => ({ reportText, isCollected, isOpened })

describe('report state table', () => {
  test('no report, no opened: none', () => expect(classifyReport(facts(null))).toBe('none'))
  test('opened only: opened', () => expect(classifyReport(facts(null, false, true))).toBe('opened'))
  test('report without completedAt: in-progress', () => expect(classifyReport(facts(inProgressReport, false, true))).toBe('in-progress'))
  test('completedAt, not collected: waiting', () => {
    expect(classifyReport(facts(lightReport, false, true))).toBe('waiting')
    expect(classifyReport(facts(docReviewReport))).toBe('waiting')
  })
  test('collected or resolved: closed whatever else exists', () => {
    expect(classifyReport(facts(lightReport, true, true))).toBe('collected')
    expect(classifyReport(facts(null, true))).toBe('collected')
  })
  test('malformed and half-written JSON: malformed, no throw', () => {
    expect(classifyReport(facts('{"completedAt": "2026', false, true))).toBe('malformed')
    expect(classifyReport(facts(''))).toBe('malformed')
    expect(classifyReport(facts('[]'))).toBe('malformed')
    expect(classifyReport(facts('null'))).toBe('malformed')
  })
  test('empty completedAt is not final', () => {
    expect(classifyReport(facts('{"completedAt":""}'))).toBe('in-progress')
  })
})

describe('summaries', () => {
  test('verdict counts skip removed items and count missing status as unanswered', () => {
    expect(verdictCounts(parseJson(detailedReport) as Record<string, unknown>)).toEqual({ pass: 0, partial: 1, fail: 1, skip: 1, unanswered: 1 })
  })
  test('decisions are read from items[*].decisions; empty choice is undecided', () => {
    expect(decisionCounts(parseJson(docReviewReport) as Record<string, unknown>)).toEqual({ answered: 2, total: 3 })
    expect(decisionCounts({ decisions: [{ id: 'x', choice: 'Yes' }], items: [] })).toEqual({ answered: 0, total: 0 })
  })
  test('summarise', () => {
    const s = summarise(parseJson(lightReport) as Record<string, unknown>)
    expect(s.completedAt).toBe('2026-01-15T09:11:31.520Z')
    expect(s.counts.pass).toBe(1)
    expect(s.title).toContain('export button')
  })
  test('request title: frontmatter, quoted, heading fallback', () => {
    expect(requestTitle('---\nid: x\ntitle: "Quoted title"\n---\nbody')).toBe('Quoted title')
    expect(requestTitle('---\nid: x\n---\n\n# First heading\n')).toBe('First heading')
    expect(requestTitle('no title')).toBe(null)
  })
})
