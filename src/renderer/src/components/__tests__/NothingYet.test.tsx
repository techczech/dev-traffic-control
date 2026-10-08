import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const app = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('../../state/app', () => ({ useApp: () => app }))

import { NothingYetEmpty } from '../NothingYet'
import { nothingFiledYet } from '../../lib/getStarted'

afterEach(cleanup)

test('the empty Inbox points to Get started only when nothing was ever filed', () => {
  expect(nothingFiledYet(null)).toBe(false)
  expect(nothingFiledYet({ runs: [] })).toBe(true)
  expect(nothingFiledYet({ runs: [{}] } as never)).toBe(false)

  render(<NothingYetEmpty />)
  expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeTruthy()
  expect(
    screen.getByText('Your agents have not filed anything. See Get started to connect them.')
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'get-started' })
})
