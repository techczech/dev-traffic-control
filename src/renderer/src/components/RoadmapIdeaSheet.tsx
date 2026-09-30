import { ArrowUp, Plus } from 'lucide-react'
import type { PoolIdea, PoolTier } from '../../../main/qa/pool'

export type RoadmapIdeaSheetState =
  | {
      kind: 'promote'
      idea: PoolIdea
      release: string
      customRelease: boolean
      specWanted: boolean
    }
  | { kind: 'setaside'; idea: PoolIdea; reason: string }
  | { kind: 'add'; title: string; bodyMarkdown: string; tier: PoolTier }

export function RoadmapIdeaSheet({
  sheet,
  releases,
  pending,
  onChange,
  onCancel,
  onConfirm
}: {
  sheet: RoadmapIdeaSheetState
  releases: readonly string[]
  pending: boolean
  onChange: (sheet: RoadmapIdeaSheetState) => void
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const canConfirm =
    sheet.kind === 'promote'
      ? sheet.release.trim().length > 0
      : sheet.kind === 'setaside'
        ? sheet.reason.trim().length > 0
        : sheet.title.trim().length > 0
  return (
    <div className="roadmap-sheet" role="presentation" onMouseDown={onCancel}>
      <section
        className="roadmap-sheet-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="roadmap-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          {sheet.kind === 'add' ? <Plus aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
          <strong id="roadmap-sheet-title">
            {sheet.kind === 'promote'
              ? 'Promote into design'
              : sheet.kind === 'setaside'
                ? 'Set aside'
                : 'Add an idea'}
          </strong>
        </header>
        <div className="roadmap-sheet-body">
          {sheet.kind !== 'add' && (
            <label className="roadmap-sheet-field">
              <span>The idea</span>
              <output>{sheet.idea.title}</output>
            </label>
          )}
          {sheet.kind === 'add' ? (
            <>
              <label className="roadmap-sheet-field">
                <span>Title</span>
                <input
                  autoFocus
                  type="text"
                  value={sheet.title}
                  placeholder="What should the app do?"
                  onChange={(event) => onChange({ ...sheet, title: event.target.value })}
                />
              </label>
              <label className="roadmap-sheet-field">
                <span>Idea</span>
                <textarea
                  rows={6}
                  value={sheet.bodyMarkdown}
                  placeholder="Add the detail an agent will need."
                  onChange={(event) => onChange({ ...sheet, bodyMarkdown: event.target.value })}
                />
              </label>
              <fieldset className="roadmap-sheet-field">
                <legend>Lane</legend>
                <div className="roadmap-sheet-options">
                  {(
                    [
                      ['functionality', 'Functionality'],
                      ['quality-of-life', 'Quality of life'],
                      ['delight', 'Delight']
                    ] as const
                  ).map(([tier, label]) => (
                    <button
                      key={tier}
                      type="button"
                      className={sheet.tier === tier ? 'on' : ''}
                      aria-pressed={sheet.tier === tier}
                      onClick={() => onChange({ ...sheet, tier })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : sheet.kind === 'promote' ? (
            <>
              <fieldset className="roadmap-sheet-field">
                <legend>Which release</legend>
                <div className="roadmap-sheet-options">
                  {releases.map((release) => (
                    <button
                      key={release}
                      type="button"
                      className={
                        !sheet.customRelease && sheet.release === release ? 'on mono' : 'mono'
                      }
                      aria-pressed={!sheet.customRelease && sheet.release === release}
                      onClick={() => onChange({ ...sheet, release, customRelease: false })}
                    >
                      {release}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={sheet.customRelease ? 'on' : ''}
                    aria-pressed={sheet.customRelease}
                    onClick={() => onChange({ ...sheet, release: '', customRelease: true })}
                  >
                    A new release…
                  </button>
                </div>
                {sheet.customRelease && (
                  <input
                    autoFocus
                    type="text"
                    value={sheet.release}
                    aria-label="New release"
                    placeholder="Version"
                    onChange={(event) => onChange({ ...sheet, release: event.target.value })}
                  />
                )}
              </fieldset>
              <fieldset className="roadmap-sheet-field">
                <legend>Before anyone builds it</legend>
                <button
                  type="button"
                  className={`roadmap-sheet-choice${sheet.specWanted ? ' on' : ''}`}
                  aria-pressed={sheet.specWanted}
                  onClick={() => onChange({ ...sheet, specWanted: true })}
                >
                  <span aria-hidden="true">✓</span>
                  Ask for a spec first — it appears in Specs when written
                </button>
                <button
                  type="button"
                  className={`roadmap-sheet-choice${!sheet.specWanted ? ' on' : ''}`}
                  aria-pressed={!sheet.specWanted}
                  onClick={() => onChange({ ...sheet, specWanted: false })}
                >
                  <span aria-hidden="true">✓</span>
                  No spec needed, this one is clear
                </button>
              </fieldset>
            </>
          ) : (
            <label className="roadmap-sheet-field">
              <span>Why are you setting it aside?</span>
              <input
                autoFocus
                type="text"
                value={sheet.reason}
                placeholder="One-line reason"
                onChange={(event) => onChange({ ...sheet, reason: event.target.value })}
              />
            </label>
          )}
          <footer>
            <button type="button" className="roadmap-sheet-cancel" onClick={onCancel}>
              Cancel <kbd>Esc</kbd>
            </button>
            <button
              type="button"
              className="roadmap-sheet-confirm"
              disabled={!canConfirm || pending}
              onClick={onConfirm}
            >
              {pending
                ? 'Saving…'
                : sheet.kind === 'promote'
                  ? 'Promote'
                  : sheet.kind === 'setaside'
                    ? 'Set aside'
                    : 'Add idea'}
              <kbd>⌘↵</kbd>
            </button>
          </footer>
        </div>
      </section>
    </div>
  )
}
