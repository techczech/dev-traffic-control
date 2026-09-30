import { afterEach, expect, test, vi } from 'vitest'
import * as growth from '../growTextarea'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('observeTextareaGrowth remeasures wrapped content when ResizeObserver reports a width change', () => {
  let callback: ResizeObserverCallback | undefined
  const observe = vi.fn()
  const disconnect = vi.fn()

  class TestResizeObserver {
    constructor(next: ResizeObserverCallback) {
      callback = next
    }

    observe = observe
    disconnect = disconnect
    unobserve(): void {
      return
    }
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver)

  const textarea = document.createElement('textarea')
  let measuredHeight = 30
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    get: () => measuredHeight
  })

  const observeTextareaGrowth = (
    growth as unknown as {
      observeTextareaGrowth?: (element: HTMLTextAreaElement) => () => void
    }
  ).observeTextareaGrowth

  expect(typeof observeTextareaGrowth).toBe('function')
  if (!observeTextareaGrowth) return

  const cleanup = observeTextareaGrowth(textarea)
  expect(observe).toHaveBeenCalledWith(textarea)
  expect(textarea.style.height).toBe('30px')

  measuredHeight = 74
  callback?.([], {} as ResizeObserver)

  expect(textarea.style.height).toBe('74px')

  cleanup()
  expect(disconnect).toHaveBeenCalledOnce()
})
