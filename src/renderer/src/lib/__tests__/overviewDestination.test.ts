import { expect, test } from 'vitest'
import { overviewDestination } from '../overviewDestination'

test('Overview shows the fleet under All projects', () => {
  expect(overviewDestination({ kind: 'all' })).toEqual({ kind: 'fleet' })
})

test('Overview shows the scoped project home', () => {
  expect(overviewDestination({ kind: 'project', slug: 'windmill' })).toEqual({
    kind: 'project-home',
    slug: 'windmill'
  })
})
