import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { FindBar } from '../FindBar'

afterEach(cleanup)

test('find updates matches, moves next and previous, then Escape closes and returns focus', () => {
  const close = vi.fn()
  const returnFocus = document.createElement('button')
  document.body.append(returnFocus)
  render(
    <>
      <div data-find-scope>Answered once, then answered twice.</div>
      <FindBar open onClose={close} returnFocus={returnFocus} />
    </>
  )

  const input = screen.getByRole('textbox', { name: 'Find in document' })
  fireEvent.change(input, { target: { value: 'answered' } })
  expect(screen.getByText('1 of 2')).toBeTruthy()

  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByText('2 of 2')).toBeTruthy()
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(screen.getByText('1 of 2')).toBeTruthy()

  fireEvent.keyDown(input, { key: 'Escape' })
  expect(close).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(returnFocus)
  returnFocus.remove()
})
