import { describe, expect, test } from 'claude-code/testing'

import { formatWhen } from './when'

const utc = () => 0
const bst = () => 60
// Fri 2026-10-02 14:05 UTC
const NOW = Date.parse('2026-10-02T14:05:00Z')
const at = (iso: string) => Date.parse(iso)

describe('formatWhen', () => {
  test('the five forms', () => {
    expect(formatWhen(at('2026-10-02T08:52:00Z'), NOW, utc)).toBe('today 08:52')
    expect(formatWhen(at('2026-10-01T08:52:00Z'), NOW, utc)).toBe('yesterday 08:52')
    expect(formatWhen(at('2026-09-30T08:11:00Z'), NOW, utc)).toBe('Wed 08:11')
    expect(formatWhen(at('2026-09-12T08:11:00Z'), NOW, utc)).toBe('12 Sep')
    expect(formatWhen(at('2025-09-12T08:11:00Z'), NOW, utc)).toBe('12 Sep 2025')
  })
  test('seven days ago is a date, six is a weekday', () => {
    expect(formatWhen(at('2026-09-26T10:00:00Z'), NOW, utc)).toBe('Sat 10:00')
    expect(formatWhen(at('2026-09-25T10:00:00Z'), NOW, utc)).toBe('25 Sep')
  })
  test('midnight is judged in the local zone, not UTC', () => {
    const now = at('2026-10-02T23:30:00Z') // 00:30 on the 3rd in UTC+1
    const then = at('2026-10-02T22:30:00Z')
    expect(formatWhen(then, now, bst)).toBe('yesterday 23:30')
    expect(formatWhen(then, now, utc)).toBe('today 22:30')
    expect(formatWhen(at('2026-10-02T23:10:00Z'), now, bst)).toBe('today 00:10'.replace('today', 'today'))
  })
  test('year turns in the local zone', () => {
    expect(formatWhen(at('2025-12-31T23:30:00Z'), at('2026-01-20T10:00:00Z'), bst)).toBe('1 Jan')
    expect(formatWhen(at('2025-12-31T23:30:00Z'), at('2026-01-20T10:00:00Z'), utc)).toBe('31 Dec 2025')
  })
  test('date only drops the clock; a future instant reads as today', () => {
    expect(formatWhen(at('2026-10-01T08:52:00Z'), NOW, utc, true)).toBe('yesterday')
    expect(formatWhen(at('2026-09-30T08:11:00Z'), NOW, utc, true)).toBe('Wed')
    expect(formatWhen(at('2026-10-02T20:00:00Z'), NOW, utc)).toBe('today 20:00')
  })
})
