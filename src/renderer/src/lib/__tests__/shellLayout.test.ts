import { expect, test } from 'vitest'
import { shellLayout } from '../shellLayout'

test('wide and browsing: the list is out and the name and tabs sit in the pane', () => {
  expect(shellLayout('rail', 'browse')).toEqual({ rail: true, header: 'pane', listToggle: true })
})

test('wide and focused: no list, the name and tabs are in the title bar', () => {
  expect(shellLayout('rail', 'focus')).toEqual({
    rail: false,
    header: 'titlebar',
    listToggle: true
  })
})

test('a narrow window is always focus mode, whatever the mode says', () => {
  for (const presentation of ['front-page', 'pushed-in'] as const) {
    for (const mode of ['browse', 'focus'] as const) {
      expect(shellLayout(presentation, mode)).toEqual({
        rail: false,
        header: 'titlebar-row',
        listToggle: false
      })
    }
  }
})
