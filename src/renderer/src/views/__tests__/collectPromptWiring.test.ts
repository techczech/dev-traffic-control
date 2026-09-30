import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'

for (const view of ['Runner', 'Reading', 'LightRun']) {
  test(`${view} shows the collect control only on its finished surface`, async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src', 'renderer', 'src', 'views', `${view}.tsx`),
      'utf8'
    )

    expect(source).toContain('<FinishedCollectionStatus')
    expect(source).toContain('completedAt={report.completedAt')
  })
}

test('the shared finished state keeps the existing collect prompt control', async () => {
  const source = await readFile(
    path.join(
      process.cwd(),
      'src',
      'renderer',
      'src',
      'components',
      'FinishedCollectionStatus.tsx'
    ),
    'utf8'
  )

  expect(source).toContain('<CollectPromptButton')
  expect(source).toContain('finished')
})

// Finishing hands him the collect prompt without a second press. All three
// finish paths ride the same shared courtesy copy beside the manual control.
for (const view of ['Runner', 'Reading', 'LightRun']) {
  test(`${view} finishes with the collect prompt already copied`, async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src', 'renderer', 'src', 'views', `${view}.tsx`),
      'utf8'
    )

    expect(source).toContain('copyCollectPromptAfterFinish(')
  })
}
