import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'

for (const view of ['Runner', 'LightRun', 'Reading']) {
  test(`${view} renders the shared finished-run collection state`, async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src', 'renderer', 'src', 'views', `${view}.tsx`),
      'utf8'
    )

    expect(source).toContain('<FinishedCollectionStatus')
    expect(source).toContain('<AgentStatus')
  })
}
