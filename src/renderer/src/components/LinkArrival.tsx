import { useState } from 'react'
import { Check, Clock, Copy, Folder, Layers, Link2, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useApp } from '../state/app'
import { projectDisplayName } from '../lib/projectStanding'
import { formatFullAge } from '../lib/dateVocabulary'
import { inertLinkText, type DeepLinkLanding } from '../../../shared/deepLink'

/**
 * What a `dtc://` link looks like when it arrives (mockup states 19–22).
 *
 * Three states, and the last two are held deliberately apart:
 *
 * - **opened** — a banner naming where the window landed, and, when the app was
 *   already running, saying in as many words that no other window moved.
 * - **behind** — amber clock, the project named, and a button that pulls and
 *   then opens. The link is fine; the file has not arrived.
 * - **refused** — red shield, no project, and nothing to press but close and
 *   copy. Retrying is exactly what must not be offered, because the link is
 *   the problem. The link itself is shown back as inert text (ticket 40) so
 *   The reviewer can send it to the agent that wrote it.
 *
 * If sync lag ever wore the red shield, the red shield would stop meaning
 * anything — which is why the two are drawn side by side and built apart.
 */

function projectName(releases: Parameters<typeof projectDisplayName>[0], slug: string): string {
  return projectDisplayName(releases, slug)
}

export function LinkArrivalBanner(): React.JSX.Element | null {
  const { linkArrival, snapshot, dismissLinkArrival } = useApp()
  if (!linkArrival) return null

  if (linkArrival.kind === 'refused') {
    return (
      <div className="link-arrival stop" role="alert">
        <ShieldAlert className="ic" strokeWidth={2} />
        <span className="grow">
          <b>Link refused</b> — nothing was opened
        </span>
      </div>
    )
  }

  if (linkArrival.kind === 'behind') {
    const pulled = linkArrival.lastPulledAt
      ? formatFullAge(linkArrival.lastPulledAt, new Date())
      : ''
    return (
      <div className="link-arrival warn" role="alert">
        <Clock className="ic" strokeWidth={2} />
        <span className="grow">
          <b>Not on this Mac yet</b>
          {pulled ? ` — last pulled ${pulled}` : ''}
        </span>
      </div>
    )
  }

  const name = projectName(snapshot?.releases, linkArrival.project)
  return (
    <div className="link-arrival info" role="status">
      <Link2 className="ic" strokeWidth={2} />
      <span className="grow">
        {linkArrival.coldLaunch ? (
          <>
            <b>Opened from a link</b> — Dev Traffic Control started up on this record in {name}.
          </>
        ) : (
          <>
            <b>New window, opened from a link</b> — this one is in {name}; your other windows stayed
            where they were.
          </>
        )}
      </span>
      <span className="url" title={linkArrival.url}>
        <Link2 className="ic" strokeWidth={2} />
        {linkArrival.url}
      </span>
      <button
        type="button"
        className="dismiss"
        aria-label="Dismiss this message"
        onClick={dismissLinkArrival}
      >
        <X className="ic" strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * The refused link, shown back as text and nothing more (ticket 40).
 *
 * It is the string that arrived, cleaned of control and bidirectional
 * characters and cut to about 200 characters (`inertLinkText`). It is rendered
 * as a React text node in a `<code>`: never an anchor, never an `href`, never
 * parsed, decoded or resolved, so there is nothing in it to click or follow.
 */
export function RefusedLinkText({ url }: { url: string | undefined }): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const { display, copy } = inertLinkText(url)
  if (!display) return null
  return (
    <div className="refused-link">
      <code className="refused-link-text" aria-label="The refused link" translate="no">
        {display}
      </code>
      <div className="refused-link-row">
        <span className="refused-link-hint">Send this to the agent that gave it to you.</span>
        <button
          type="button"
          className="secbtn"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(copy)
              .then(() => setCopied(true))
              .catch(() => {})
          }}
        >
          {copied ? (
            <Check className="ic" strokeWidth={2} />
          ) : (
            <Copy className="ic" strokeWidth={2} />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

/**
 * The two states that replace the surface rather than sitting above it. The
 * refusal shows the link only as inert text (`RefusedLinkText`) and never what
 * it would have opened; the sync-lag state has nothing useful to show but the
 * project.
 */
export function LinkArrivalTakeover({
  arrival
}: {
  arrival: Extract<DeepLinkLanding, { kind: 'behind' | 'refused' }>
}): React.JSX.Element {
  const { snapshot, openProject, dismissLinkArrival, retryLinkArrival, linkRetryInFlight } =
    useApp()

  if (arrival.kind === 'refused') {
    return (
      <div className="link-arrival-panel stop">
        <span className="medallion">
          <ShieldAlert className="ic" strokeWidth={1.8} />
        </span>
        <h2>That link asked for something outside your records</h2>
        <p>
          Dev Traffic Control only ever opens files inside your record folder. This link aimed
          somewhere else, so it was turned away before anything was read.
        </p>
        <RefusedLinkText url={arrival.url} />
        <p className="aside">
          Any web page can fire a link like this one, so a link that reaches past the folder is
          always refused rather than checked.
        </p>
        <div className="acts">
          <button type="button" className="secbtn" onClick={dismissLinkArrival}>
            <Layers className="ic" strokeWidth={2} />
            Close and carry on
          </button>
        </div>
      </div>
    )
  }

  const name = projectName(snapshot?.releases, arrival.project)
  const pulled = arrival.lastPulledAt ? formatFullAge(arrival.lastPulledAt, new Date()) : ''
  return (
    <div className="link-arrival-panel warn">
      <span className="medallion">
        <RefreshCw className="ic" strokeWidth={1.8} />
      </span>
      <h2>This record has not reached this Mac</h2>
      <p>
        The link points at a {name} record that was filed elsewhere.
        {pulled
          ? ` Your record folder was last pulled ${pulled}, so it is not here yet.`
          : ' It is not here yet.'}
      </p>
      <div className="acts">
        <button
          type="button"
          className="primbtn"
          disabled={linkRetryInFlight}
          onClick={retryLinkArrival}
        >
          <RefreshCw className="ic" strokeWidth={2} />
          {linkRetryInFlight ? 'Pulling…' : 'Pull now and open it'}
        </button>
        <button
          type="button"
          className="secbtn"
          onClick={() => {
            dismissLinkArrival()
            openProject(arrival.project)
          }}
        >
          <Folder className="ic" strokeWidth={2} />
          Open {name} instead
        </button>
      </div>
    </div>
  )
}
