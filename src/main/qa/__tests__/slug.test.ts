import { describe, expect, test } from 'vitest'
import { slugify, uniqueId } from '../slug'

describe('slugify', () => {
  test('lowercases, hyphenates, strips punctuation', () => {
    expect(slugify('Cover page 30% sidebar')).toBe('cover-page-30-sidebar')
  })
  test('collapses runs and trims hyphens', () => {
    expect(slugify('  QR — overlap   fix!! ')).toBe('qr-overlap-fix')
  })
  test('never returns empty', () => {
    expect(slugify('***')).toBe('item')
  })
})

describe('uniqueId', () => {
  test('appends -2, -3 on collision', () => {
    const taken = new Set(['undo'])
    expect(uniqueId('undo', taken)).toBe('undo-2')
    taken.add('undo-2')
    expect(uniqueId('undo', taken)).toBe('undo-3')
  })
})
