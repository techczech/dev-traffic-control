import { AlertTriangle, Ship } from 'lucide-react'
import { useState } from 'react'
import type { PoolTier } from '../../../main/qa/pool'
import { useCommandScope } from '../commands/provider'

interface UnfinishedFeature {
  id: string
  title: string
  tier?: PoolTier
}

export function ReleaseShipSheet({
  app,
  version,
  initialNotes,
  unfinished,
  fixesTarget,
  onCancel,
  onConfirm,
  onError
}: {
  app: string
  version: string
  initialNotes: string
  unfinished: readonly UnfinishedFeature[]
  fixesTarget?: string
  onCancel: () => void
  onConfirm: (notes: string, fixesTo?: string) => Promise<void>
  onError: (message: string) => void
}): React.JSX.Element {
  const [notes, setNotes] = useState(initialNotes)
  const [fixesTo, setFixesTo] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  useCommandScope({
    'app.close-back': { priority: 50, handler: onCancel },
    'release.ship-own': {
      priority: 50,
      handler: () => setFixesTo(undefined)
    },
    'release.ship-fixes': {
      enabled: !!fixesTarget,
      priority: 50,
      handler: () => fixesTarget && setFixesTo(fixesTarget)
    },
    'release.ship-confirm': {
      enabled: !pending,
      priority: 50,
      handler: () => void confirm()
    }
  })

  async function confirm(): Promise<void> {
    if (pending) return
    setPending(true)
    try {
      await onConfirm(notes, fixesTo)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The release could not be shipped.')
      setPending(false)
    }
  }

  return (
    <div className="release-ship-sheet" role="presentation">
      <section
        className="release-ship-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ship-title"
      >
        <header>
          <Ship aria-hidden="true" />
          <h2 id="ship-title">
            Ship {app} {version}
          </h2>
        </header>
        <div className="release-ship-body">
          {unfinished.length > 0 && (
            <div className="release-ship-warning">
              <AlertTriangle aria-hidden="true" />
              <span>
                <strong>
                  {unfinished.length === 1
                    ? 'One feature is not started'
                    : `${unfinished.length} features are not started`}
                </strong>{' '}
                — {quotedTitles(unfinished)}. Shipping now returns{' '}
                {unfinished.length === 1 ? 'it' : 'them'} to the pool rather than losing{' '}
                {unfinished.length === 1 ? 'it' : 'them'}
                {unfinished.length === 1 && unfinished[0].tier
                  ? `; it will be there under ${tierName(unfinished[0].tier)}.`
                  : '.'}
              </span>
            </div>
          )}
          <label className="release-ship-field">
            <span>The notes, written from the release record — edit them before they set</span>
            <textarea
              value={notes}
              rows={10}
              autoFocus
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <fieldset className="release-ship-field">
            <legend>This version is</legend>
            <div className="release-ship-options">
              <button
                type="button"
                className={!fixesTo ? 'on' : ''}
                aria-pressed={!fixesTo}
                onClick={() => setFixesTo(undefined)}
              >
                A release of its own
              </button>
              {fixesTarget && (
                <button
                  type="button"
                  className={fixesTo === fixesTarget ? 'on' : ''}
                  aria-pressed={fixesTo === fixesTarget}
                  onClick={() => setFixesTo(fixesTarget)}
                >
                  Fixes to {fixesTarget}
                </button>
              )}
            </div>
          </fieldset>
          <footer>
            <button
              type="button"
              className="release-ship-cancel"
              disabled={pending}
              onClick={onCancel}
            >
              Not yet
            </button>
            <span />
            <button
              type="button"
              className="release-ship-confirm"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? 'Shipping…' : 'Ship it and freeze the notes'}
            </button>
          </footer>
        </div>
      </section>
    </div>
  )
}

function quotedTitles(features: readonly UnfinishedFeature[]): string {
  return features.map((feature) => `“${feature.title}”`).join(', ')
}

function tierName(tier: PoolTier): string {
  if (tier === 'quality-of-life') return 'Quality of life'
  return tier[0].toUpperCase() + tier.slice(1)
}
