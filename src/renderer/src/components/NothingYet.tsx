import { BadgeCheck, Inbox as InboxIcon, SquarePen } from 'lucide-react'
import { useApp } from '../state/app'

/** The empty-Inbox block. */
export function NothingYetEmpty(): React.JSX.Element {
  const { navigate } = useApp()
  return (
    <div className="empty">
      <div className="motif" aria-hidden="true">
        <i />
        <i />
        <i />
        <BadgeCheck className="ic" strokeWidth={2} />
      </div>
      <h2>Nothing yet</h2>
      <p>Your agents have not filed anything. See Get started to connect them.</p>
      <button type="button" className="primbtn" onClick={() => navigate({ kind: 'get-started' })}>
        Get started
      </button>
    </div>
  )
}

/** The whole empty Inbox view, head included, for the All-projects Inbox. */
export function NothingYetInbox(): React.JSX.Element {
  return (
    <div className="view">
      <div className="vhead">
        <InboxIcon className="ic l" strokeWidth={2} />
        <span className="vt">Inbox</span>
        <span className="grow" />
        <button className="ghostbtn" disabled title="Open a project or a run to write a note">
          <SquarePen className="ic" strokeWidth={2} />
          New note
        </button>
      </div>
      <NothingYetEmpty />
    </div>
  )
}
