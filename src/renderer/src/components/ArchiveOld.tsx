import { useMemo, useState } from 'react'
import { Archive } from 'lucide-react'
import { useApp } from '../state/app'
import { useCommandScope } from '../commands/provider'
import { ARCHIVE_AGES, archiveOldCandidates, type ArchiveAge } from '../lib/archiveOld'

/**
 * "Archive old…" on an Overview: under All projects it clears
 * across every project, inside a project only that project. The reviewer picks the age
 * each time and sees how many items each age would clear before confirming.
 * Everything archived stays in its archived bin and can be restored.
 */
export function ArchiveOld({
  scope
}: {
  scope: { kind: 'all' } | { kind: 'project'; slug: string }
}): React.JSX.Element | null {
  const { snapshot, housekeeping, archiveOld, showToast } = useApp()
  const [open, setOpen] = useState(false)
  const [age, setAge] = useState<ArchiveAge>(14)
  const [pending, setPending] = useState(false)
  const now = useMemo(() => new Date(), [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const scopeKey = scope.kind === 'all' ? '' : scope.slug
  const byAge = useMemo(
    () =>
      snapshot
        ? ARCHIVE_AGES.map((days) => ({
            days,
            candidates: archiveOldCandidates(
              snapshot,
              scopeKey ? { kind: 'project', slug: scopeKey } : { kind: 'all' },
              days,
              now,
              housekeeping
            )
          }))
        : [],
    [snapshot, scopeKey, now, housekeeping]
  )

  useCommandScope(
    open ? { 'app.close-back': { priority: 100, handler: () => setOpen(false) } } : {}
  )

  const chosen = byAge.find((option) => option.days === age)?.candidates
  if (!snapshot) return null

  const confirm = async (): Promise<void> => {
    if (!chosen || chosen.total === 0 || pending) return
    setPending(true)
    try {
      const done = await archiveOld({
        requests: chosen.requests,
        threads: chosen.threads,
        handoffs: chosen.handoffs
      })
      const count = done.requests + done.threads + done.handoffs
      showToast(
        `Archived ${count} old item${count === 1 ? '' : 's'}. They are in the archived bin.`
      )
      setOpen(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Archiving failed; nothing was changed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button type="button" className="archive-old-trigger" onClick={() => setOpen(true)}>
        <Archive className="ic" strokeWidth={2} />
        Archive old…
      </button>
      {open && (
        <div
          className="overlay archive-old-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Archive old items"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div className="archive-old-sheet">
            <h2>Archive old items</h2>
            <p className="archive-old-lede">
              {scope.kind === 'all'
                ? 'Across every project: requests waiting on you, handoffs ready and open decisions.'
                : 'In this project: requests waiting on you, handoffs ready and open decisions.'}{' '}
              Release features waiting on a verdict are never archived.
            </p>
            <div className="archive-old-ages" role="radiogroup" aria-label="How old">
              {byAge.map(({ days, candidates }) => (
                <label key={days} className={age === days ? 'on' : ''}>
                  <input
                    type="radio"
                    name="archive-age"
                    checked={age === days}
                    onChange={() => setAge(days as ArchiveAge)}
                  />
                  <span>Older than {days} days</span>
                  <span className="count">
                    {candidates.total} item{candidates.total === 1 ? '' : 's'}
                  </span>
                </label>
              ))}
            </div>
            <div className="archive-old-actions">
              <button type="button" className="archive-old-cancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="archive-old-confirm"
                disabled={!chosen || chosen.total === 0 || pending}
                onClick={() => void confirm()}
              >
                {chosen && chosen.total > 0
                  ? `Archive ${chosen.total} item${chosen.total === 1 ? '' : 's'}`
                  : 'Nothing that old'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
