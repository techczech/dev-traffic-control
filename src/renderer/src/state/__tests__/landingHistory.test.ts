import { expect, test } from 'vitest'
import { landingHistory } from '../app'

test('a release link lands on Releases at its version and feature, over the dash', () => {
  expect(landingHistory({ kind: 'release', version: '0.34.0', feature: 'handout-fix' })).toEqual([
    { kind: 'dashboard' },
    { kind: 'releases', version: '0.34.0', feature: 'handout-fix' }
  ])
})

test('roadmap and handoff links land on their surface with the item chosen', () => {
  expect(landingHistory({ kind: 'roadmap', idea: 'faster-export' })).toEqual([
    { kind: 'dashboard' },
    { kind: 'roadmap', idea: 'faster-export' }
  ])
  expect(landingHistory({ kind: 'handoff', path: '/r/sketchpad/handoffs/x-handoff.md' })).toEqual([
    { kind: 'dashboard' },
    { kind: 'handoffs', path: '/r/sketchpad/handoffs/x-handoff.md' }
  ])
})
