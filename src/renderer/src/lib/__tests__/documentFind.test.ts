import { describe, expect, test } from 'vitest'
import { findTextMatches, nextMatchIndex } from '../documentFind'

describe('document find', () => {
  test('finds incremental case-insensitive matches', () => {
    expect(findTextMatches('Answered once; answered twice.', 'ANSWERED')).toEqual([
      { start: 0, end: 8 },
      { start: 15, end: 23 }
    ])
    expect(findTextMatches('Answered once', '')).toEqual([])
  })

  test('moves next and previous with wrapping', () => {
    expect(nextMatchIndex(0, 3, 1)).toBe(1)
    expect(nextMatchIndex(2, 3, 1)).toBe(0)
    expect(nextMatchIndex(0, 3, -1)).toBe(2)
    expect(nextMatchIndex(-1, 3, -1)).toBe(2)
  })
})
