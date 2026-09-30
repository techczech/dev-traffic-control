import { describe, expect, test } from 'vitest'
import { formatDenseAge, formatDenseDay, formatFullAge } from '../dateVocabulary'

function localIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
}

describe('date vocabulary', () => {
  const now = new Date(2026, 8, 12, 12, 0, 0)

  test.each([
    // Today prints the clock time (Dominik 2026-09-27).
    [localIso(2026, 9, 12, 11, 59, 31), '11:59', 'today 11:59'],
    [localIso(2026, 9, 12, 11, 48), '11:48', 'today 11:48'],
    [localIso(2026, 9, 12, 7), '07:00', 'today 07:00'],
    [localIso(2026, 9, 11, 23), 'yesterday', 'yesterday'],
    [localIso(2026, 9, 10, 12), '10 Sep', 'Thu 10 Sep'],
    [localIso(2025, 12, 3, 12), '3 Dec 2025', 'Wed 3 Dec 2025']
  ])('formats one ladder for %s', (iso, dense, full) => {
    expect(formatDenseAge(iso, now)).toBe(dense)
    expect(formatFullAge(iso, now)).toBe(full)
  })

  test('today’s time is 24-hour and zero-padded', () => {
    expect(formatDenseAge(localIso(2026, 9, 12, 9, 5), now)).toBe('09:05')
    expect(formatFullAge(localIso(2026, 9, 12, 0, 0), now)).toBe('today 00:00')
    expect(formatFullAge(localIso(2026, 9, 12, 11), now)).toBe('today 11:00')
  })

  test('crossing midnight changes immediately to yesterday', () => {
    const justAfterMidnight = new Date(2026, 8, 12, 0, 5)
    const justBeforeMidnight = localIso(2026, 9, 11, 23, 55)

    expect(formatDenseAge(justBeforeMidnight, justAfterMidnight)).toBe('yesterday')
    expect(formatFullAge(justBeforeMidnight, justAfterMidnight)).toBe('yesterday')
  })

  test('crossing into a new year keeps yesterday ahead of the year label', () => {
    const newYear = new Date(2026, 0, 1, 0, 5)

    expect(formatDenseAge(localIso(2025, 12, 31, 23, 55), newYear)).toBe('yesterday')
    expect(formatFullAge(localIso(2025, 12, 31, 23, 55), newYear)).toBe('yesterday')
    expect(formatDenseAge(localIso(2025, 12, 30, 12), newYear)).toBe('30 Dec 2025')
    expect(formatFullAge(localIso(2025, 12, 30, 12), newYear)).toBe('Tue 30 Dec 2025')
  })

  test('returns the specified fallbacks for unparseable input', () => {
    expect(formatDenseAge('not-a-date', now)).toBe('')
    expect(formatFullAge('not-a-date', now)).toBe('unknown time')
  })
})

describe('formatDenseDay (ticket 25, a release row’s since:)', () => {
  const now = new Date(2026, 8, 28, 9, 0)
  test('a bare day is that day where he is, and today has no clock time', () => {
    expect(formatDenseDay('2026-09-28', now)).toBe('today')
    expect(formatDenseDay('2026-09-27', now)).toBe('yesterday')
    expect(formatDenseDay('2026-09-20', now)).toBe('20 Sep')
    expect(formatDenseDay('2025-12-01', now)).toBe('1 Dec 2025')
  })
  test('a full timestamp reads exactly as formatDenseAge', () => {
    const iso = new Date(2026, 8, 28, 7, 5).toISOString()
    expect(formatDenseDay(iso, now)).toBe(formatDenseAge(iso, now))
  })
})
