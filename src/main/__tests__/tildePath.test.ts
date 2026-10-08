import { expect, test } from 'vitest'
import { tildePath } from '../../shared/tildePath'

test('shortens the given home directory', () => {
  expect(tildePath('/Users/a/Documents/Dev Traffic Control', '/Users/a')).toBe(
    '~/Documents/Dev Traffic Control'
  )
  expect(tildePath('/Users/a', '/Users/a/')).toBe('~')
  expect(tildePath('/Users/ab/x', '/Users/a')).toBe('/Users/ab/x')
})

test('without a home it shortens the usual user prefix and leaves other paths alone', () => {
  expect(tildePath('/Users/a/work/records')).toBe('~/work/records')
  expect(tildePath('/home/a/records')).toBe('~/records')
  expect(tildePath('/srv/records')).toBe('/srv/records')
})
