import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { copyCollectPromptAfterFinish } from '../collectPromptCopy'

const COPIED = 'Collect prompt copied — paste it to the agent that asked.'
const NOT_COPIED = 'Finished — the collect prompt could not be copied.'

function installCopy(impl: () => Promise<void>): ReturnType<typeof vi.fn> {
  const copyCollectPrompt = vi.fn(impl)
  Object.defineProperty(window, 'qa', {
    configurable: true,
    writable: true,
    value: { copyCollectPrompt }
  })
  return copyCollectPrompt
}

beforeEach(() => {
  installCopy(async () => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('a successful finish leaves the collect prompt on the clipboard and says so', async () => {
  const copyCollectPrompt = installCopy(async () => {})
  const showToast = vi.fn()
  await copyCollectPromptAfterFinish(
    '/qa/wordforge/2026-07-27-light.md',
    'Light request',
    showToast
  )
  expect(copyCollectPrompt).toHaveBeenCalledWith(
    '/qa/wordforge/2026-07-27-light.md',
    'Light request'
  )
  expect(showToast).toHaveBeenCalledTimes(1)
  expect(showToast).toHaveBeenCalledWith(COPIED)
})

test('a rejected clipboard call costs the prompt, never the finish', async () => {
  installCopy(async () => {
    throw new Error('clipboard unavailable')
  })
  const showToast = vi.fn()
  // Resolving at all is the point: the caller's finish must not see a throw.
  await copyCollectPromptAfterFinish(
    '/qa/wordforge/2026-07-27-light.md',
    'Light request',
    showToast
  )
  expect(showToast).toHaveBeenCalledTimes(1)
  expect(showToast).toHaveBeenCalledWith(NOT_COPIED)
})
