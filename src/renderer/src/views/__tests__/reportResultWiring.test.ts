import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'

for (const view of ['LightRun', 'Runner', 'Reading']) {
  test(`${view} validates finish and reopen IPC result shapes before using reports`, async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src', 'renderer', 'src', 'views', `${view}.tsx`),
      'utf8'
    )
    const validations = source.match(/validateReportMutationResult\(result\)/g) ?? []
    const saveValidations = source.match(/validateSaveReportResult\(result\)/g) ?? []

    expect(validations).toHaveLength(2)
    expect(saveValidations).toHaveLength(1)
    expect(source).not.toContain('setSaveError(result.refusal)')
  })
}
