import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Ban,
  AlignJustify,
  Check,
  CircleAlert,
  ClipboardCheck,
  Flag,
  GitMerge,
  Hammer,
  Link2,
  Quote,
  SquarePen,
  X,
  ClipboardCopy
} from 'lucide-react'
import type { RequestFate } from '../../../main/qa/featureRequest'
import { versionCore } from '../../../shared/releaseVersionOrder'
import type { FeatureRequestRow } from '../lib/featureRequests'
import { relatedChips, type ChipTarget, type RecordIndex } from '../lib/recordChips'
import { nothingNeeded, type RequestAction, type RequestActionId } from '../lib/requestFate'
import { RecordChipButton } from './RecordChipButton'

/**
 * One feature request as the card: what the reviewer asked for, the
 * context, the plan, what they can do, the fate chip, and the records it names.
 * The buttons do not write; they hand the answer to `onAnswer`.
 */

const FATE_ICONS: Record<RequestFate | 'none', typeof Check> = {
  waiting: CircleAlert,
  planned: Flag,
  building: Hammer,
  built: Check,
  merged: GitMerge,
  declined: Ban,
  none: CircleAlert
}

const ACTION_ICONS: Partial<Record<RequestActionId, typeof Check>> = {
  approve: Check,
  'open-roadmap': AlignJustify,
  'take-off': X,
  change: SquarePen,
  move: ArrowRightLeft,
  try: ClipboardCheck,
  'not-right': SquarePen
}

export function FateChip({
  row,
  big
}: {
  row: Pick<FeatureRequestRow, 'fate' | 'fateLabel'>
  big?: boolean
}): React.JSX.Element {
  const key = row.fate ?? 'none'
  const Icon = FATE_ICONS[key]
  return (
    <span className={`fate ${key}${big ? ' big' : ''}`}>
      <Icon className="ic" strokeWidth={2} aria-hidden="true" />
      {row.fateLabel}
    </span>
  )
}

export function FeatureRequestCard({
  row,
  index,
  showProject,
  pending,
  onBack,
  onOpen,
  onAnswer,
  onCopyPlan
}: {
  row: FeatureRequestRow
  index: RecordIndex
  showProject: boolean
  pending: boolean
  onBack: () => void
  onOpen: (target: ChipTarget) => void
  onAnswer: (action: RequestAction, note: string) => Promise<boolean>
  onCopyPlan: () => void
}): React.JSX.Element {
  const [composing, setComposing] = useState<RequestAction | null>(null)
  const [note, setNote] = useState('')
  const related = relatedChips(row.related, index)

  async function send(action: RequestAction, text: string): Promise<void> {
    const sent = await onAnswer(action, text)
    if (sent) {
      setComposing(null)
      setNote('')
    }
  }

  function press(action: RequestAction): void {
    if (action.asks === 'none') void send(action, '')
    else {
      setComposing(action)
      setNote('')
    }
  }

  const lastEntries = row.entries.slice(-4)
  return (
    <div className="fr-cardwrap">
      <button type="button" className="fr-back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> All feature requests
      </button>
      <article className={`fr-card f-${row.fate ?? 'none'}`} aria-label={row.title}>
        <header className="fr-head">
          <h2>{row.title}</h2>
          <FateChip row={row} big />
          <span className="sub">
            {showProject ? `${row.project} · ` : ''}idea {row.id}
            {row.addedLabel ? ` · added ${row.addedLabel}` : ''}
          </span>
        </header>
        <div className="fr-grid">
          <div className="fr-col">
            <section className="fr-sec">
              <span className="fr-lbl">
                <Quote aria-hidden="true" />
                You asked for
              </span>
              {row.quotes.length === 0 ? (
                <p className="fr-p">No quote was recorded for this one.</p>
              ) : (
                row.quotes.map((quote, position) => {
                  const linked = quote.link ? relatedChips([quote.link], index)[0]?.chip : null
                  return (
                    <blockquote className="fr-quote" key={position}>
                      {quote.text ? `“${quote.text}”` : null}
                      {(quote.where || quote.when) && (
                        <div className="fr-src">
                          {quote.where &&
                            (linked ? (
                              <button
                                type="button"
                                className="fr-chip"
                                onClick={() => onOpen(linked.target)}
                              >
                                <Link2 aria-hidden="true" />
                                {quote.where}
                              </button>
                            ) : (
                              <span className="fr-chip">
                                <Link2 aria-hidden="true" />
                                {quote.where}
                              </span>
                            ))}
                          {quote.when && <span>{quote.when}</span>}
                        </div>
                      )}
                    </blockquote>
                  )
                })
              )}
            </section>
            <section className="fr-sec">
              <span className="fr-lbl">Context</span>
              {row.context ? (
                <p className="fr-p">{row.context}</p>
              ) : (
                <p className="fr-none">No context recorded. The agent owes you one.</p>
              )}
            </section>
            {lastEntries.length > 0 && (
              <section className="fr-sec">
                <span className="fr-lbl">Entries</span>
                <div className="fr-entries">
                  {lastEntries.map((entry, position) => (
                    <div className={`fr-entry ${entry.by}`} key={position}>
                      <span className="by">
                        {entry.by === 'reviewer' ? 'You' : 'Agent'}
                        {entry.at ? ` · ${entry.at}` : ''}
                      </span>{' '}
                      <b>{entry.answer}</b>
                      {entry.note && <p>{entry.note}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="fr-col">
            <section className="fr-sec">
              <span className="fr-lbl">Plan</span>
              {row.plan ? (
                <p className="fr-p">{row.plan}</p>
              ) : (
                <>
                  <p className="fr-none">No plan recorded. The agent owes you one.</p>
                  {row.group !== 'finished' && (
                    <button type="button" className="fr-btn" onClick={onCopyPlan}>
                      <ClipboardCopy aria-hidden="true" />
                      Ask an agent to plan this
                    </button>
                  )}
                </>
              )}
              {row.group === 'waiting' && row.pending && (
                <p className="fr-p">
                  Would go into{' '}
                  <span className="fr-chip rel">
                    <Flag aria-hidden="true" />
                    {row.pending} · pending
                  </span>
                </p>
              )}
              {row.group === 'planned' && row.release && (
                <p className="fr-p">
                  On the roadmap in{' '}
                  <span className="fr-chip rel">
                    <Flag aria-hidden="true" />
                    {row.release}
                    {row.pending && versionCore(row.release) === row.pending ? ' · pending' : ''}
                  </span>
                  {row.fateNote ? ` ${row.fateNote}` : ''}
                </p>
              )}
              {row.group !== 'planned' &&
                !(row.group === 'waiting' && row.pending) &&
                row.release && (
                  <p className="fr-p">
                    {row.fate === 'built' ? 'Shipped in ' : 'Aimed at '}
                    <span className="fr-chip rel">
                      <Flag aria-hidden="true" />
                      {row.release}
                    </span>
                    {row.fateNote ? ` ${row.fateNote}` : ''}
                  </p>
                )}
              {!row.release && row.fateNote && <p className="fr-p">{row.fateNote}</p>}
              {row.group === 'planned' && !row.release && (
                <p className="fr-p">On the roadmap, not yet in a release.</p>
              )}
            </section>
            <section className="fr-sec">
              <span className="fr-lbl act">What you can do</span>
              {row.actions.length > 0 && (
                <div className="fr-acts">
                  {row.actions.map((action) => {
                    const Icon = ACTION_ICONS[action.id]
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className={`fr-btn${action.primary ? ' first' : ''}${
                          action.id === 'not-now' || action.id === 'fold' ? ' quiet' : ''
                        }`}
                        disabled={pending}
                        onClick={() => press(action)}
                      >
                        {Icon && <Icon aria-hidden="true" />}
                        {action.label}
                      </button>
                    )
                  })}
                </div>
              )}
              {composing && (
                <form
                  className="fr-compose"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (note.trim()) void send(composing, note)
                  }}
                >
                  <label htmlFor="fr-note">
                    {composing.asks === 'release'
                      ? 'Which release should it move to?'
                      : composing.id === 'not-right'
                        ? 'What is not right?'
                        : 'What should change?'}
                  </label>
                  {composing.asks === 'release' ? (
                    <input
                      id="fr-note"
                      value={note}
                      autoFocus
                      onChange={(event) => setNote(event.target.value)}
                    />
                  ) : (
                    <textarea
                      id="fr-note"
                      value={note}
                      autoFocus
                      onChange={(event) => setNote(event.target.value)}
                    />
                  )}
                  <div className="row">
                    <button
                      type="submit"
                      className="fr-btn first"
                      disabled={pending || !note.trim()}
                    >
                      Send to the agent
                    </button>
                    <button
                      type="button"
                      className="fr-btn quiet"
                      onClick={() => setComposing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {row.group === 'waiting' && (
                <div className="fr-note">
                  <ArrowRight aria-hidden="true" />
                  <span>
                    <b>Approve → Roadmap</b>{' '}
                    {row.pending
                      ? `puts it in the pending release, ${row.pending}. You can move it to another release there.`
                      : 'puts it on the Roadmap, with no release yet. You can move it to a release there.'}
                  </span>
                </div>
              )}
              {row.group === 'planned' && row.approvedLabel && (
                <div className="fr-note">
                  <Check aria-hidden="true" />
                  <span>
                    <b>Approved {row.approvedLabel}.</b> It is now a card in{' '}
                    {row.release
                      ? `${row.pending && versionCore(row.release) === row.pending ? 'Pending ' : ''}${row.release}`
                      : 'Unscheduled'}{' '}
                    on the Roadmap tab, at the bottom of the column. It stays in this list with its
                    fate.
                  </span>
                </div>
              )}
              <div className="fr-nothing">{nothingNeeded(row.fate, !!row.answered)}</div>
            </section>
          </div>
        </div>
        <footer className="fr-foot">
          <span className="fr-lbl">Related</span>
          {related.length === 0 ? (
            <p className="fr-p">Nothing is linked to this request yet.</p>
          ) : (
            <div className="fr-recs">
              {related.map(({ name, chip }) =>
                chip ? (
                  <RecordChipButton key={name} chip={chip} onOpen={onOpen} />
                ) : (
                  <span className="rec unresolved" key={name} title="No record by this name here">
                    <span className="rt">{name}</span>
                    <span className="rs">Not in the record</span>
                  </span>
                )
              )}
            </div>
          )}
        </footer>
      </article>
    </div>
  )
}
