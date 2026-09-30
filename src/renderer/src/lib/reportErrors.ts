import type { ReportWriteRefusal } from '../../../shared/ipc'
import { REPORT_RECOVERY_MARKER } from '../../../shared/ipc'
import type { QaReport } from '../../../main/qa/types'

export type ReportDisplayError = ReportWriteRefusal | { kind: 'generic'; message?: string }

export function reportDisplayError(error: unknown): ReportDisplayError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    error.kind === 'invalid-on-disk' &&
    'path' in error &&
    typeof error.path === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return { kind: 'invalid-on-disk', path: error.path, message: error.message }
  }
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : ''
  const recoveryStart = rawMessage.indexOf(REPORT_RECOVERY_MARKER)
  return {
    kind: 'generic',
    ...(recoveryStart >= 0 ? { message: rawMessage.slice(recoveryStart) } : {})
  }
}

export type ValidatedReportMutation =
  { report: QaReport; error: null } | { report: null; error: ReportDisplayError }

const GENERIC_REPORT_MUTATION_ERROR: ReportDisplayError = {
  kind: 'generic',
  message: 'Could not update the report. Try again.'
}

const GENERIC_REPORT_SAVE_ERROR: ReportDisplayError = {
  kind: 'generic',
  message: 'Could not save the report. Try again.'
}

export function validateReportMutationResult(value: unknown): ValidatedReportMutation {
  if (isRecord(value) && value.ok === true && isRecord(value.report)) {
    return { report: value.report as unknown as QaReport, error: null }
  }
  if (isRecord(value) && value.ok === false && Object.hasOwn(value, 'refusal')) {
    const error = reportDisplayError(value.refusal)
    return {
      report: null,
      error: error.message ? error : GENERIC_REPORT_MUTATION_ERROR
    }
  }
  return { report: null, error: GENERIC_REPORT_MUTATION_ERROR }
}

export type ValidatedSaveReport =
  { savedAt: string; error: null } | { savedAt: null; error: ReportDisplayError }

export function validateSaveReportResult(value: unknown): ValidatedSaveReport {
  if (isRecord(value) && value.ok === true && typeof value.savedAt === 'string') {
    return { savedAt: value.savedAt, error: null }
  }
  if (isRecord(value) && value.ok === false && Object.hasOwn(value, 'refusal')) {
    const error = reportDisplayError(value.refusal)
    return {
      savedAt: null,
      error: error.message ? error : GENERIC_REPORT_SAVE_ERROR
    }
  }
  return { savedAt: null, error: GENERIC_REPORT_SAVE_ERROR }
}

export function recoveryFailureMessage(error: ReportDisplayError): string {
  return error.message ?? 'Could not set the old report aside. The damaged report was not changed.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
