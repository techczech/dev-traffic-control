import { describe, expect, test } from 'vitest'
import { runLabel } from '../format'
import type { SerializableRun } from '../../../../shared/ipc'

describe('runLabel', () => {
  test('returns the request title', () => {
    const run = { request: { title: 'Title padding' } } as unknown as SerializableRun
    expect(runLabel(run)).toBe('Title padding')
  })
})
