import { expect, test } from 'vitest'
import { ReportRecoveryWriteError } from '../../../../main/runnerIo'
import * as shared from '../../../../shared/ipc'
import * as reportErrors from '../reportErrors'

test('the main recovery error and renderer parser share the recovery marker', () => {
  const marker = (shared as unknown as { REPORT_RECOVERY_MARKER?: string }).REPORT_RECOVERY_MARKER
  expect(marker).toBe('The damaged report was set aside to ')

  const mainError = new ReportRecoveryWriteError('/tmp/request.report.corrupt.json', new Error())
  expect(mainError.message).toContain(marker)
  expect(reportErrors.reportDisplayError(mainError)).toEqual({
    kind: 'generic',
    message: mainError.message.slice(mainError.message.indexOf(marker!))
  })
})

test('a malformed successful report mutation becomes a visible generic failure', () => {
  const validate = (
    reportErrors as unknown as {
      validateReportMutationResult?: (value: unknown) => {
        report: unknown | null
        error: { kind: string; message?: string } | null
      }
    }
  ).validateReportMutationResult
  expect(typeof validate).toBe('function')

  expect(validate?.({ ok: true })).toEqual({
    report: null,
    error: {
      kind: 'generic',
      message: 'Could not update the report. Try again.'
    }
  })
})

test('a failed report mutation without a refusal becomes a visible generic failure', () => {
  const validate = (
    reportErrors as unknown as {
      validateReportMutationResult?: (value: unknown) => {
        report: unknown | null
        error: { kind: string; message?: string } | null
      }
    }
  ).validateReportMutationResult

  expect(validate?.({ ok: false })).toEqual({
    report: null,
    error: {
      kind: 'generic',
      message: 'Could not update the report. Try again.'
    }
  })
})

test('a failed autosave without a refusal becomes a visible generic failure', () => {
  const validate = (
    reportErrors as unknown as {
      validateSaveReportResult?: (value: unknown) => {
        savedAt: string | null
        error: { kind: string; message?: string } | null
      }
    }
  ).validateSaveReportResult

  expect(validate?.({ ok: false })).toEqual({
    savedAt: null,
    error: {
      kind: 'generic',
      message: 'Could not save the report. Try again.'
    }
  })
})
