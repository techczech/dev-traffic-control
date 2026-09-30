import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Inspector } from '../Inspector'

beforeEach(() => {
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: {
      readRecordFiles: vi.fn(async (files: string[]) =>
        files.map((file) => ({
          file,
          content: file.endsWith('.json') ? '{"live":true}\n' : '# Raw request\n'
        }))
      )
    }
  })
})

afterEach(cleanup)

test('shows exact request and live report bytes in read-only tabs', async () => {
  render(
    <Inspector
      target={{ kind: 'run', path: '/record/project/request.md' }}
      revision="one"
      onClose={vi.fn()}
    />
  )

  expect(await screen.findByText('# Raw request')).toBeTruthy()
  screen.getByRole('button', { name: 'report.json' }).click()
  expect(await screen.findByText('{"live":true}')).toBeTruthy()
  await waitFor(() =>
    expect(window.qa.readRecordFiles).toHaveBeenCalledWith([
      '/record/project/request.md',
      '/record/project/request.report.json'
    ])
  )
})
