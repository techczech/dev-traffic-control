import { waitFor, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { QaSnapshot, SerializableRun } from '../../../../shared/ipc'
import type { ProjectRelease, ReleaseFeature } from '../../../../main/qa/releaseRecords'

/**
 * Ticket 05. The model is tested as data in lib/__tests__/projectHome.test.ts;
 * these check what the drawing insists on that data cannot show — the release
 * block leads the page, every row is a way in, and the degenerate cases read
 * as facts rather than as a broken page.
 */

const app = vi.hoisted(() => ({
  snapshot: null as QaSnapshot | null,
  navigate: vi.fn(),
  markSeen: vi.fn(),
  settings: undefined as { verdictLayout: 'one' | 'all' } | undefined,
  changeSetting: vi.fn()
}))

vi.mock('../../state/app', () => ({ useApp: () => app }))
// The canvas redraw needs a real DOM; the sheet's own wiring is what is tested.
vi.mock('../../lib/imageToPng', async (original) => ({
  ...(await original<typeof import('../../lib/imageToPng')>()),
  blobToPngBase64: vi.fn().mockResolvedValue('UE5H')
}))

import { ProjectHome } from '../ProjectHome'
import { CommandProvider } from '../../commands/provider'

beforeEach(() => {
  app.navigate.mockReset()
  app.markSeen.mockReset()
  app.changeSetting.mockReset()
  app.settings = undefined
})

afterEach(cleanup)

test('a release that needs him takes the top of the page, above everything else', () => {
  app.snapshot = snapshot({
    runs: [run('Poll preview')],
    releases: [release([{ id: 'div', title: 'Divider inference', kind: 'feature', status: 'you' }])]
  })
  const { container } = render(<ProjectHome slug="tallyboard" />)

  const scroll = container.querySelector('.phome-scroll')!
  const block = screen.getByRole('region', { name: 'The release needs you' })
  // Only the quiet Archive old control (ticket 22) may sit above it.
  const sections = [...scroll.children].filter(
    (child) => !child.classList.contains('phome-toolbar')
  )
  expect(sections[0]).toBe(block)
  expect(within(block).getByText('0.31.0 is stopped on one verdict')).toBeTruthy()

  // Ticket 21: the verdict is given in a sheet, never on Releases.
  fireEvent.click(within(block).getByRole('button', { name: /Give the verdict/ }))
  expect(screen.getByRole('dialog', { name: 'Verdict 1 of 1' })).toBeTruthy()
  expect(app.navigate).not.toHaveBeenCalledWith({ kind: 'releases' })
})

test('the verdict sheet walks every waiting feature, records each answer, and closes onto the home', async () => {
  const answerRelease = vi.fn().mockResolvedValue({})
  ;(window as unknown as { qa: { answerRelease: typeof answerRelease } }).qa = { answerRelease }
  app.snapshot = snapshot({
    releases: [
      release([
        {
          id: 'a',
          title: 'First feature',
          kind: 'feature',
          status: 'you',
          howToCheck: 'Do the first thing.'
        },
        { id: 'b', title: 'Second feature', kind: 'feature', status: 'you' },
        { id: 'c', title: 'Third feature', kind: 'feature', status: 'you' },
        { id: 'd', title: 'Built already', kind: 'feature', status: 'built' }
      ])
    ]
  })
  render(<ProjectHome slug="tallyboard" />)
  const block = screen.getByRole('region', { name: 'The release needs you' })

  // Picking the second question opens the sheet there.
  fireEvent.click(within(block).getByRole('button', { name: 'Second feature' }))
  let sheet = screen.getByRole('dialog', { name: 'Verdict 2 of 3' })
  expect(within(sheet).getByRole('heading', { name: 'Second feature' })).toBeTruthy()
  expect(within(sheet).getByText('Back to TallyBoard')).toBeTruthy()

  fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'looks wrong' } })
  fireEvent.click(within(sheet).getByRole('button', { name: /Something's off/ }))
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Verdict 3 of 3' })).toBeTruthy())
  expect(answerRelease).toHaveBeenCalledWith({
    project: 'tallyboard',
    version: '0.31.0',
    id: 'b',
    verdict: 'off',
    comment: 'looks wrong'
  })

  // Skip moves on without answering; past the last one the sheet closes.
  sheet = screen.getByRole('dialog', { name: 'Verdict 3 of 3' })
  fireEvent.click(within(sheet).getByRole('button', { name: 'Skip for now' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(answerRelease).toHaveBeenCalledTimes(1)
  expect(app.navigate).not.toHaveBeenCalledWith({ kind: 'releases' })

  // Works from the first question records a verdict with no comment.
  fireEvent.click(within(block).getByRole('button', { name: /Give the verdict/ }))
  sheet = screen.getByRole('dialog', { name: 'Verdict 1 of 3' })
  expect(within(sheet).getByText('Do the first thing.')).toBeTruthy()
  fireEvent.click(within(sheet).getByRole('button', { name: /Works/ }))
  await waitFor(() => expect(answerRelease).toHaveBeenCalledTimes(2))
  expect(answerRelease).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'a', verdict: 'works', comment: '' })
  )

  // Back closes the sheet.
  fireEvent.click(screen.getByText('Back to TallyBoard'))
  expect(screen.queryByRole('dialog')).toBeNull()
})

/**
 * Fix round: on TallyBoard's real record the block said "stopped on four
 * verdicts" and drew one question, the other three clipped away.
 */
test('the release block names every waiting feature by its title, never its steps', () => {
  const titles = ['Divider inference', 'Title regime', 'Poll rendering', 'Convergence']
  const paragraph =
    'Open any talk and compare two slides whose titles are very different lengths, then ' +
    'check the sidebar layout and the top layout both hold the same title size throughout.'
  app.snapshot = snapshot({
    releases: [
      release(
        titles.map((title, i) => ({
          id: `q${i}`,
          title,
          kind: 'feature',
          status: 'you',
          howToCheck: i === 0 ? paragraph : undefined,
          prose: i === 1 ? 'One title size across every layout.' : undefined
        }))
      )
    ]
  })
  render(<ProjectHome slug="tallyboard" />)

  const block = screen.getByRole('region', { name: 'The release needs you' })
  const heroes = block.querySelectorAll('.phome-hero')
  expect(heroes).toHaveLength(4)
  heroes.forEach((hero, i) => {
    expect(hero.querySelector('.q')?.textContent).toBe(titles[i])
  })
  // How-to-check steps never appear in the block, not even on hover.
  expect(block.textContent).not.toContain('Open any talk')
  expect(heroes[0].querySelector('.q')?.getAttribute('title')).toBe(titles[0])
  // What the feature is follows its title on the detail line.
  expect(heroes[1].querySelector('.m')?.textContent).toBe(
    'One title size across every layout. · asked Fri 11 Sep'
  )
  expect(heroes[0].querySelector('.m')?.textContent).toBe('asked Fri 11 Sep')
  // The actions sit on the first question only, as drawn.
  expect(within(block).getAllByRole('button', { name: /Give the verdict/ })).toHaveLength(1)
  expect(heroes[0].querySelector('.f')).toBeTruthy()
  expect(block.querySelector('[data-home-more]')).toBeNull()
})

test('past four waiting questions the block draws four and counts the rest', () => {
  app.snapshot = snapshot({
    releases: [
      release(
        Array.from({ length: 7 }, (_, i) => ({
          id: `q${i}`,
          title: `Question ${i}`,
          kind: 'feature' as const,
          status: 'you' as const
        }))
      )
    ]
  })
  render(<ProjectHome slug="tallyboard" />)

  const block = screen.getByRole('region', { name: 'The release needs you' })
  expect(block.querySelectorAll('.phome-hero:not(.more)')).toHaveLength(4)
  expect(within(block).getByText('3 more waiting on your verdict')).toBeTruthy()
})

test('recent requests without notes takes the column’s width, not half of it', () => {
  app.snapshot = snapshot({
    runs: [run('Poll preview')],
    releases: [release([{ id: 'd', title: 'Diagram family', kind: 'feature', status: 'building' }])]
  })
  render(<ProjectHome slug="tallyboard" />)

  const requests = screen.getByRole('region', { name: 'Recent requests' })
  expect(requests.closest('.phome-pair')).toBeNull()
  expect(requests.parentElement?.className).toBe('phome-stack')
})

test('every row opens its record', () => {
  app.snapshot = snapshot({ runs: [run('Sweep triage shell')] })
  render(<ProjectHome slug="tallyboard" />)

  const waiting = screen.getByRole('region', { name: 'Waiting on you' })
  fireEvent.click(within(waiting).getByText('Sweep triage shell'))

  expect(app.navigate).toHaveBeenCalledWith({
    kind: 'runner',
    path: '/record/tallyboard/requests/Sweep triage shell.md'
  })
  expect(app.markSeen).toHaveBeenCalled()
})

// Ticket 12: what the retired project view did that the drawn home did not.
test('a project with round subfolders gets a rounds card, each round summed and a way in', () => {
  const inRound: SerializableRun = {
    ...run('Round request'),
    round: 'v1.1-review',
    request: {
      ...run('Round request').request,
      path: '/record/tallyboard/v1.1-review/2026-09-18-round-request.md'
    }
  }
  app.snapshot = snapshot({ runs: [inRound] })
  render(<ProjectHome slug="tallyboard" />)

  const rounds = screen.getByRole('region', { name: 'Rounds' })
  expect(within(rounds).getByText('1 run · no notes')).toBeTruthy()
  fireEvent.click(within(rounds).getByText('v1.1-review'))
  expect(app.navigate).toHaveBeenCalledWith({
    kind: 'runner',
    path: '/record/tallyboard/v1.1-review/2026-09-18-round-request.md'
  })

  // And in the layout a project with a release takes.
  cleanup()
  app.snapshot = snapshot({
    runs: [inRound],
    releases: [release([{ id: 'd', title: 'Diagram family', kind: 'feature', status: 'building' }])]
  })
  render(<ProjectHome slug="tallyboard" />)
  expect(screen.getByRole('region', { name: 'Rounds' })).toBeTruthy()
})

test('a project without rounds draws no rounds card', () => {
  app.snapshot = snapshot({ runs: [run('Loose request')] })
  render(<ProjectHome slug="tallyboard" />)
  expect(screen.queryByRole('region', { name: 'Rounds' })).toBeNull()
})

test('a note can be written into a project that already has records', () => {
  app.snapshot = snapshot({ runs: [run('Loose request')] })
  render(<ProjectHome slug="tallyboard" />)
  fireEvent.keyDown(window, { key: 'n' })
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'note', newIn: '/record/tallyboard' })
})

test('no release record says so in a plain sentence, and the rest keeps its place', () => {
  app.snapshot = snapshot({ runs: [run('Sweep triage shell')] })
  render(<ProjectHome slug="tallyboard" />)

  const releaseCard = screen.getByRole('region', { name: 'Release' })
  expect(within(releaseCard).getByText('none declared')).toBeTruthy()
  expect(
    within(releaseCard).getByText('Nobody has declared what Tallyboard is working towards.')
  ).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Requests' })).toBeTruthy()
  // Handoffs is drawn even when none are ready, and says so.
  expect(screen.getByText('None ready right now.')).toBeTruthy()
})

test('an empty project is one sentence and the one thing that would change it', () => {
  app.snapshot = snapshot({})
  const { container } = render(<ProjectHome slug="tallyboard" />)

  expect(screen.getByText('Nothing has been recorded here yet')).toBeTruthy()
  // No scaffolding of blank cards pretending to be sections.
  expect(container.querySelectorAll('.phome-card')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: /Write the first note/ }))
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'note', newIn: '/record/tallyboard' })
})

test('the example project’s Dash carries no strip: Remove example lives in the title bar (ticket 36)', () => {
  app.snapshot = { ...snapshot({}), projects: ['example-app'] }
  render(<ProjectHome slug="example-app" />)
  expect(screen.getByText('Nothing has been recorded here yet')).toBeTruthy()
  expect(screen.queryByText('Remove example')).toBeNull()
  expect(screen.queryByText('This is the example project.')).toBeNull()
})

test('a long list draws its newest rows and a quiet line counting the rest', () => {
  app.snapshot = snapshot({
    runs: Array.from({ length: 15 }, (_, i) => run(`Request ${i}`, `2026-09-${10 + i}T09:00:00Z`))
  })
  render(<ProjectHome slug="tallyboard" />)

  const requests = screen.getByRole('region', { name: 'Requests' })
  expect(within(requests).getByText('15')).toBeTruthy()
  expect(within(requests).getAllByRole('button')).toHaveLength(4)
  expect(within(requests).getByText('11 more requests')).toBeTruthy()
})

// Ticket 25, drawing B.
test('+ New note sits at the top of the Dash whether or not anything is owed', () => {
  app.snapshot = snapshot({
    releases: [release([{ id: 'b', title: 'Built', kind: 'feature', status: 'built' }])]
  })
  const { container } = render(<ProjectHome slug="tallyboard" />)
  const toolbar = container.querySelector('.phome-toolbar')!
  expect(container.querySelector('.phome-scroll')!.firstElementChild).toBe(toolbar)
  // Nothing is owed, so Archive old is not drawn; New note still is.
  expect(within(toolbar as HTMLElement).queryByText(/Archive old/)).toBeNull()
  fireEvent.click(within(toolbar as HTMLElement).getByRole('button', { name: 'New note' }))
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'note', newIn: '/record/tallyboard' })
})

test('+ New note shows on an empty project too, beside Write the first note', () => {
  app.snapshot = snapshot({})
  render(<ProjectHome slug="tallyboard" />)
  fireEvent.click(screen.getByRole('button', { name: 'New note' }))
  expect(app.navigate).toHaveBeenCalledWith({ kind: 'note', newIn: '/record/tallyboard' })
  expect(screen.getByRole('button', { name: /Write the first note/ })).toBeTruthy()
})

// Ticket 25: dates on release rows, after the pill.
test('a release row shows the day its feature reached its state after the pill', () => {
  app.snapshot = snapshot({
    releases: [
      release([
        { id: 'a', title: 'Dated', kind: 'feature', status: 'built', since: '2026-09-02' },
        { id: 'b', title: 'Undated', kind: 'feature', status: 'notstarted' }
      ])
    ]
  })
  render(<ProjectHome slug="tallyboard" />)
  const card = screen.getByRole('region', { name: 'Release' })
  const dated = within(card).getByRole('button', { name: /Dated/ })
  const meta = dated.querySelector('.meta')!
  expect([...meta.children].map((child) => child.className)).toEqual(['phome-pill built', 'age'])
  expect(meta.querySelector('.age')!.textContent).toBe('2 Sep')
  const undated = within(card).getByRole('button', { name: /Undated/ })
  expect(undated.querySelector('.age')).toBeNull()
})

// Ticket 25, drawing verdict-sheet-shots.
test('a picture pasted into the verdict sheet is stored for that feature and goes with the verdict', async () => {
  const answerRelease = vi.fn().mockResolvedValue({})
  const addVerdictShot = vi.fn().mockResolvedValue('releases/0.31.0.shots/a-1.png')
  const readVerdictShot = vi.fn().mockResolvedValue('data:image/png;base64,UE5H')
  ;(window as unknown as { qa: unknown }).qa = { answerRelease, addVerdictShot, readVerdictShot }
  app.snapshot = snapshot({
    releases: [release([{ id: 'a', title: 'First feature', kind: 'feature', status: 'you' }])]
  })
  render(<ProjectHome slug="tallyboard" />)
  fireEvent.click(screen.getByRole('button', { name: /Give the verdict/ }))
  const sheet = screen.getByRole('dialog', { name: 'Verdict 1 of 1' })

  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  fireEvent.paste(window, {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] }
  })
  await waitFor(() =>
    expect(addVerdictShot).toHaveBeenCalledWith({
      project: 'tallyboard',
      version: '0.31.0',
      id: 'a',
      pngBase64: 'UE5H'
    })
  )
  expect(await within(sheet).findByRole('button', { name: 'Zoom a-1.png' })).toBeTruthy()
  expect(readVerdictShot).toHaveBeenCalledWith({
    project: 'tallyboard',
    version: '0.31.0',
    rel: 'releases/0.31.0.shots/a-1.png'
  })

  fireEvent.click(within(sheet).getByRole('button', { name: /Something's off/ }))
  await waitFor(() =>
    expect(answerRelease).toHaveBeenCalledWith({
      project: 'tallyboard',
      version: '0.31.0',
      id: 'a',
      verdict: 'off',
      comment: '',
      screenshots: ['releases/0.31.0.shots/a-1.png']
    })
  )
})

test('a picture removed with its ✕ does not go with the verdict', async () => {
  const answerRelease = vi.fn().mockResolvedValue({})
  const addVerdictShot = vi.fn().mockResolvedValue('releases/0.31.0.shots/a-1.png')
  const readVerdictShot = vi.fn().mockResolvedValue('data:image/png;base64,UE5H')
  ;(window as unknown as { qa: unknown }).qa = { answerRelease, addVerdictShot, readVerdictShot }
  app.snapshot = snapshot({
    releases: [release([{ id: 'a', title: 'First feature', kind: 'feature', status: 'you' }])]
  })
  render(<ProjectHome slug="tallyboard" />)
  fireEvent.click(screen.getByRole('button', { name: /Give the verdict/ }))
  const sheet = screen.getByRole('dialog', { name: 'Verdict 1 of 1' })
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  fireEvent.drop(sheet, { dataTransfer: { files: [file] } })
  fireEvent.click(await within(sheet).findByRole('button', { name: 'Remove a-1.png' }))
  fireEvent.click(within(sheet).getByRole('button', { name: /Works/ }))
  await waitFor(() => expect(answerRelease).toHaveBeenCalledTimes(1))
  expect(answerRelease.mock.calls[0][0]).not.toHaveProperty('screenshots')
})

test('a picture still saving when he moves on is dropped, not added to the next feature', async () => {
  const answerRelease = vi.fn().mockResolvedValue({})
  let finish: (rel: string) => void = () => {}
  const addVerdictShot = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  const readVerdictShot = vi.fn().mockResolvedValue('data:image/png;base64,UE5H')
  ;(window as unknown as { qa: unknown }).qa = { answerRelease, addVerdictShot, readVerdictShot }
  app.snapshot = snapshot({
    releases: [
      release([
        { id: 'a', title: 'First feature', kind: 'feature', status: 'you' },
        { id: 'b', title: 'Second feature', kind: 'feature', status: 'you' }
      ])
    ]
  })
  render(<ProjectHome slug="tallyboard" />)
  fireEvent.click(screen.getByRole('button', { name: /Give the verdict/ }))
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  fireEvent.paste(window, {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] }
  })
  await waitFor(() => expect(addVerdictShot).toHaveBeenCalledTimes(1))

  // He skips to the second feature before the first one's picture has saved.
  fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
  const second = screen.getByRole('dialog', { name: 'Verdict 2 of 2' })
  finish('releases/0.31.0.shots/a-1.png')
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(within(second).queryByRole('button', { name: 'Zoom a-1.png' })).toBeNull()
  expect(within(second).queryByRole('alert')).toBeNull()
  fireEvent.click(within(second).getByRole('button', { name: /Works/ }))
  await waitFor(() => expect(answerRelease).toHaveBeenCalledTimes(1))
  expect(answerRelease.mock.calls[0][0]).toMatchObject({ id: 'b' })
  expect(answerRelease.mock.calls[0][0]).not.toHaveProperty('screenshots')
})

test('plain text pasted into the comment box is not taken as a picture', () => {
  const addVerdictShot = vi.fn()
  ;(window as unknown as { qa: unknown }).qa = { answerRelease: vi.fn(), addVerdictShot }
  app.snapshot = snapshot({
    releases: [release([{ id: 'a', title: 'First feature', kind: 'feature', status: 'you' }])]
  })
  render(<ProjectHome slug="tallyboard" />)
  fireEvent.click(screen.getByRole('button', { name: /Give the verdict/ }))
  const box = within(screen.getByRole('dialog', { name: 'Verdict 1 of 1' })).getByRole('textbox')
  // fireEvent returns false when a listener called preventDefault.
  const allowed = fireEvent.paste(box, {
    clipboardData: {
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      getData: () => 'the link landed on the project'
    }
  })
  expect(allowed).toBe(true)
  expect(addVerdictShot).not.toHaveBeenCalled()
})

// ---- Ticket 27: verdicts all at once ----

function fourWaiting(): void {
  app.snapshot = snapshot({
    releases: [
      release([
        { id: 'a', title: 'First feature', kind: 'feature', status: 'you', howToCheck: 'Do A.' },
        { id: 'b', title: 'Second feature', kind: 'feature', status: 'you' },
        { id: 'c', title: 'Third feature', kind: 'feature', status: 'you' },
        { id: 'd', title: 'Fourth feature', kind: 'feature', status: 'you' },
        { id: 'e', title: 'Built already', kind: 'feature', status: 'built' }
      ])
    ]
  })
}

/** Through the real command layer, so key priority is the app's own. */
function renderWithCommands(): void {
  render(
    <CommandProvider overrides={{}} onOverridesChange={() => {}}>
      <ProjectHome slug="tallyboard" />
    </CommandProvider>
  )
}

function openAllAtOnce(): HTMLElement {
  app.settings = { verdictLayout: 'all' }
  renderWithCommands()
  fireEvent.click(screen.getByRole('button', { name: /Give the verdict/ }))
  return screen.getByRole('dialog', { name: 'Verdicts all at once' })
}

function card(sheet: HTMLElement, title: string): HTMLElement {
  return within(sheet).getByRole('article', { name: title })
}

test('the switch turns the sheet into every waiting feature as a card, and he is remembered', () => {
  ;(window as unknown as { qa: unknown }).qa = { answerRelease: vi.fn() }
  fourWaiting()
  render(<ProjectHome slug="tallyboard" />)
  fireEvent.click(screen.getByRole('button', { name: /Give the verdict/ }))
  const one = screen.getByRole('dialog', { name: 'Verdict 1 of 4' })
  expect(
    within(one).getByRole('button', { name: 'One at a time' }).getAttribute('aria-pressed')
  ).toBe('true')

  fireEvent.click(within(one).getByRole('button', { name: 'All at once' }))
  expect(app.changeSetting).toHaveBeenCalledWith('verdictLayout', 'all')
  const all = screen.getByRole('dialog', { name: 'Verdicts all at once' })
  expect(
    within(all)
      .getAllByRole('article')
      .map((el) => el.getAttribute('aria-label'))
  ).toEqual(['First feature', 'Second feature', 'Third feature', 'Fourth feature'])
  expect(within(all).getByText('0.31.0 · 4 of 4 waiting')).toBeTruthy()
  // Only the focused card opens its comment box and How to check.
  expect(within(card(all, 'First feature')).getByRole('textbox')).toBeTruthy()
  expect(within(card(all, 'Second feature')).queryByRole('textbox')).toBeNull()
  fireEvent.click(within(card(all, 'First feature')).getByRole('button', { name: 'How to check' }))
  expect(within(card(all, 'First feature')).getByText('Do A.')).toBeTruthy()

  fireEvent.click(within(all).getByRole('button', { name: 'One at a time' }))
  expect(app.changeSetting).toHaveBeenLastCalledWith('verdictLayout', 'one')
  expect(screen.getByRole('dialog', { name: 'Verdict 1 of 4' })).toBeTruthy()
})

test('Space and F answer the focused card as in a check; ↑/↓ move; answered cards fade and stay', async () => {
  const answerRelease = vi.fn().mockResolvedValue({})
  ;(window as unknown as { qa: unknown }).qa = { answerRelease }
  fourWaiting()
  const sheet = openAllAtOnce()
  expect(card(sheet, 'First feature').getAttribute('aria-current')).toBe('true')

  fireEvent.keyDown(window, { key: ' ' })
  await waitFor(() => expect(answerRelease).toHaveBeenCalledTimes(1))
  expect(answerRelease).toHaveBeenLastCalledWith({
    project: 'tallyboard',
    version: '0.31.0',
    id: 'a',
    verdict: 'works',
    comment: ''
  })
  // It stays in the list, faded, with its verdict and time; focus moves on.
  const first = card(sheet, 'First feature')
  await waitFor(() => expect(first.classList.contains('answered')).toBe(true))
  expect(within(first).getByText(/^Works · \d\d:\d\d$/)).toBeTruthy()
  expect(within(first).queryByRole('button', { name: /Works/ })).toBeNull()
  expect(card(sheet, 'Second feature').getAttribute('aria-current')).toBe('true')
  expect(within(sheet).getByText('0.31.0 · 3 of 4 waiting')).toBeTruthy()

  // ↓ moves to the third; its comment goes with Something's off.
  fireEvent.keyDown(window, { key: 'ArrowDown' })
  expect(card(sheet, 'Third feature').getAttribute('aria-current')).toBe('true')
  fireEvent.change(within(card(sheet, 'Third feature')).getByRole('textbox'), {
    target: { value: 'the edge is wrong' }
  })
  fireEvent.keyDown(window, { key: 'f' })
  await waitFor(() => expect(answerRelease).toHaveBeenCalledTimes(2))
  expect(answerRelease).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'c', verdict: 'off', comment: 'the edge is wrong' })
  )
  await waitFor(() =>
    expect(within(card(sheet, 'Third feature')).getByText(/^Something’s off · /)).toBeTruthy()
  )

  // ↑ goes back up; Space on an answered card answers nothing.
  fireEvent.keyDown(window, { key: 'ArrowUp' })
  fireEvent.keyDown(window, { key: 'ArrowUp' })
  fireEvent.keyDown(window, { key: 'ArrowUp' })
  expect(card(sheet, 'First feature').getAttribute('aria-current')).toBe('true')
  fireEvent.keyDown(window, { key: ' ' })
  expect(answerRelease).toHaveBeenCalledTimes(2)
  expect(within(sheet).getAllByRole('article')).toHaveLength(4)

  // Esc goes back.
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a picture pasted onto the focused card goes with that card’s verdict only', async () => {
  const answerRelease = vi.fn().mockResolvedValue({})
  const addVerdictShot = vi.fn().mockResolvedValue('releases/0.31.0.shots/b-1.png')
  const readVerdictShot = vi.fn().mockResolvedValue('data:image/png;base64,UE5H')
  ;(window as unknown as { qa: unknown }).qa = { answerRelease, addVerdictShot, readVerdictShot }
  fourWaiting()
  const sheet = openAllAtOnce()
  fireEvent.click(card(sheet, 'Second feature'))

  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  fireEvent.paste(window, {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] }
  })
  await waitFor(() =>
    expect(addVerdictShot).toHaveBeenCalledWith({
      project: 'tallyboard',
      version: '0.31.0',
      id: 'b',
      pngBase64: 'UE5H'
    })
  )
  expect(
    await within(card(sheet, 'Second feature')).findByRole('button', { name: 'Zoom b-1.png' })
  ).toBeTruthy()

  fireEvent.click(within(card(sheet, 'Second feature')).getByRole('button', { name: /Works/ }))
  await waitFor(() =>
    expect(answerRelease).toHaveBeenCalledWith({
      project: 'tallyboard',
      version: '0.31.0',
      id: 'b',
      verdict: 'works',
      comment: '',
      screenshots: ['releases/0.31.0.shots/b-1.png']
    })
  )
  // Clicking Works on another, unfocused card answers it with no pictures.
  fireEvent.click(within(card(sheet, 'Fourth feature')).getByRole('button', { name: /Works/ }))
  await waitFor(() => expect(answerRelease).toHaveBeenCalledTimes(2))
  expect(answerRelease.mock.calls[1][0]).toMatchObject({ id: 'd' })
  expect(answerRelease.mock.calls[1][0]).not.toHaveProperty('screenshots')
})

test('a picture still saving when its card changes never lands on another card', async () => {
  const answerRelease = vi.fn().mockResolvedValue({})
  const finishes: Array<(rel: string) => void> = []
  const addVerdictShot = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finishes.push(resolve)
      })
  )
  const readVerdictShot = vi.fn().mockResolvedValue('data:image/png;base64,UE5H')
  ;(window as unknown as { qa: unknown }).qa = { answerRelease, addVerdictShot, readVerdictShot }
  fourWaiting()
  const sheet = openAllAtOnce()
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  const paste = (): void => {
    fireEvent.paste(window, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] }
    })
  }

  // Pasted on the first card; he moves to the second before it saves.
  paste()
  await waitFor(() => expect(addVerdictShot).toHaveBeenCalledTimes(1))
  expect(addVerdictShot.mock.calls[0]).toEqual([expect.objectContaining({ id: 'a' })])
  fireEvent.keyDown(window, { key: 'ArrowDown' })
  finishes[0]('releases/0.31.0.shots/a-1.png')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(
    within(card(sheet, 'Second feature')).queryByRole('button', { name: 'Zoom a-1.png' })
  ).toBeNull()

  // Pasted on the second card, which he answers before the picture saves:
  // it goes with no verdict and does not reappear on the card focused next.
  paste()
  await waitFor(() => expect(addVerdictShot).toHaveBeenCalledTimes(2))
  fireEvent.keyDown(window, { key: ' ' })
  await waitFor(() => expect(answerRelease).toHaveBeenCalledTimes(1))
  expect(answerRelease.mock.calls[0][0]).toMatchObject({ id: 'b' })
  expect(answerRelease.mock.calls[0][0]).not.toHaveProperty('screenshots')
  finishes[1]('releases/0.31.0.shots/b-1.png')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(within(sheet).queryByRole('button', { name: 'Zoom b-1.png' })).toBeNull()
  expect(card(sheet, 'Third feature').getAttribute('aria-current')).toBe('true')
})

function snapshot(parts: { runs?: SerializableRun[]; releases?: ProjectRelease[] }): QaSnapshot {
  return {
    root: '/record',
    rootMissing: false,
    runs: parts.runs ?? [],
    notes: [],
    entries: [],
    threads: [],
    handoffs: [],
    releases: parts.releases ?? [],
    pools: [],
    projects: ['tallyboard'],
    scannedAt: '2026-09-19T09:00:00Z'
  }
}

function run(title: string, at = '2026-09-19T08:00:00Z'): SerializableRun {
  return {
    request: {
      id: title,
      title,
      labels: {},
      mode: 'test',
      items: [],
      parked: [],
      degraded: false,
      raw: '',
      path: `/record/tallyboard/requests/${title}.md`
    },
    requestMtime: at,
    report: null,
    status: 'waiting',
    project: 'tallyboard',
    round: null
  }
}

function release(features: ReleaseFeature[]): ProjectRelease {
  const record = {
    path: '/record/tallyboard/releases/0.31.0.md',
    version: '0.31.0',
    app: 'TallyBoard',
    release: '0.31.0',
    repo: 'apps/tallyboard',
    updated: '2026-09-11',
    features,
    answers: [],
    degraded: false
  }
  return {
    kind: 'recorded',
    project: 'tallyboard',
    record,
    versions: [{ version: '0.31.0', record }],
    inFlightVersion: '0.31.0'
  }
}
