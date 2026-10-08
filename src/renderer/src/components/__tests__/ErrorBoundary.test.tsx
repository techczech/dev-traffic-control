import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'

afterEach(cleanup)

function Boom(): React.JSX.Element {
  throw new TypeError("Cannot read properties of undefined (reading 'trim')")
}

describe('ErrorBoundary', () => {
  test('one card that throws is replaced by a note and its neighbours stay', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <ErrorBoundary label="Waiting on you">
          <Boom />
        </ErrorBoundary>
        <ErrorBoundary label="Roadmap">
          <p>Roadmap card</p>
        </ErrorBoundary>
      </div>
    )
    expect(screen.getByRole('note').textContent).toContain('Could not show Waiting on you')
    expect(screen.getByText('Roadmap card')).toBeTruthy()
    quiet.mockRestore()
  })

  test('a fallback of null draws nothing', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <ErrorBoundary label="the tabs" fallback={null}>
        <Boom />
      </ErrorBoundary>
    )
    expect(container.textContent).toBe('')
    quiet.mockRestore()
  })
})
