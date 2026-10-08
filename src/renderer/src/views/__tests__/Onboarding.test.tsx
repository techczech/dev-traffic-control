import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const app = vi.hoisted(() => ({
  settings: { qaRepoPath: '/records/chosen' },
  reloadSettings: vi.fn()
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))

import { Onboarding } from '../Onboarding'

test('a failed chosen-root bootstrap is caught and explained in plain words', async () => {
  const bootstrapRepo = vi.fn(async () => {
    throw new Error('EACCES')
  })
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: { bootstrapRepo, pickFolder: vi.fn() }
  })

  render(<Onboarding />)
  fireEvent.click(screen.getByRole('button', { name: 'Use this' }))

  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toMatch(/could not use that folder/i)
  )
  expect(app.reloadSettings).not.toHaveBeenCalled()
})

test('a refused bootstrap (main returns null) is a failure, never a reload', async () => {
  app.reloadSettings.mockClear()
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: { bootstrapRepo: vi.fn(async () => null), pickFolder: vi.fn() }
  })

  render(<Onboarding />)
  fireEvent.click(screen.getAllByRole('button', { name: 'Use this' }).at(-1)!)

  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toMatch(/could not use that folder/i)
  )
  expect(app.reloadSettings).not.toHaveBeenCalled()
})

test('the setup screen says where the records folder is', () => {
  app.settings = { qaRepoPath: '/Users/someone/Documents/Dev Traffic Control' }
  Object.defineProperty(window, 'qa', {
    configurable: true,
    value: { bootstrapRepo: vi.fn(), pickFolder: vi.fn() }
  })
  render(<Onboarding />)
  expect(
    screen.getAllByRole('heading', { name: 'Set up your records folder' }).length
  ).toBeGreaterThan(0)
  expect(
    screen.getAllByText(
      'Dev Traffic Control watches one folder for the requests your agents write.'
    ).length
  ).toBeGreaterThan(0)
  expect(screen.getAllByText('~/Documents/Dev Traffic Control').length).toBeGreaterThan(0)
  expect(
    screen.getAllByText(
      'The folder holds Markdown files your agents write, one per request. It can be a git repository.'
    ).length
  ).toBeGreaterThan(0)
  expect(screen.getAllByRole('button', { name: 'Use this' }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('button', { name: /Choose another folder/ }).length).toBeGreaterThan(0)
})
