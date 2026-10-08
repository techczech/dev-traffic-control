import type { BrowserWindow } from 'electron'
import { describe, expect, test, vi } from 'vitest'
import { createAllWindowsSender } from '../currentWindow'

type WindowMock = Pick<BrowserWindow, 'isDestroyed'> & { name: string }

describe('createAllWindowsSender', () => {
  test('one push reaches both live windows and skips a destroyed window', () => {
    const first: WindowMock = {
      name: 'first',
      isDestroyed: vi.fn(() => false)
    }
    const second: WindowMock = {
      name: 'second',
      isDestroyed: vi.fn(() => false)
    }
    const destroyed: WindowMock = {
      name: 'destroyed',
      isDestroyed: vi.fn(() => true)
    }
    const received: string[] = []
    const send = createAllWindowsSender(
      () => [first, destroyed, second],
      (window) => received.push(window.name)
    )

    send('snapshot')

    expect(received).toEqual(['first', 'second'])
  })

  test('a destruction race during send cannot escape the current-window boundary', () => {
    let destroyed = false
    const closing: WindowMock = {
      name: 'closing',
      isDestroyed: vi.fn(() => destroyed)
    }
    const survivor: WindowMock = {
      name: 'survivor',
      isDestroyed: vi.fn(() => false)
    }
    const received: string[] = []
    const send = createAllWindowsSender(
      () => [closing, survivor],
      () => {
        if (!destroyed) {
          destroyed = true
          throw new Error('Object has been destroyed')
        }
        received.push('survivor')
      }
    )

    expect(() => send('during teardown')).not.toThrow()
    expect(received).toEqual(['survivor'])
  })
})
