import type { ReleaseRecord } from '../main/qa/releaseRecords'

/** Drafts editable release-note prose from shipped features, never groundwork or returned work. */
export function draftReleaseNotes(record: ReleaseRecord): string {
  return record.features
    .filter((feature) => feature.kind === 'feature' && feature.status !== 'notstarted')
    .map((feature) => {
      const title = `## ${feature.title.trim()}`
      const prose = feature.prose?.trim()
      return prose ? `${title}\n\n${prose}` : title
    })
    .join('\n\n')
}

/**
 * What a version's release notes say as they stand now (ticket 28): the
 * ledger's intro paragraph, then the same features `draftReleaseNotes` drafts.
 * It stands in on a version page that has no frozen notes; it is never frozen,
 * never written and never given to anyone. Empty when the ledger has neither.
 */
export function ledgerReleaseNotes(record: ReleaseRecord): string {
  return [record.intro?.trim() ?? '', draftReleaseNotes(record)].filter(Boolean).join('\n\n')
}
