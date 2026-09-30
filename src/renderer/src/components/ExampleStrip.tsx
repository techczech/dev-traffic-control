import { useEffect, useState } from 'react'
import { useApp } from '../state/app'
import { EXAMPLE_SLUG, exampleRemoveMessage } from '../lib/getStarted'

/**
 * "This is the example project" (ticket 34, drawing example-project-dash-wide).
 * Shown on the example-app Project Dash only while main confirms the folder
 * still carries the app's marker, so a user's own project of that name never
 * gets it. Remove example asks inside the app, then main deletes the folder.
 */
export function ExampleStrip({ slug }: { slug: string }): React.JSX.Element | null {
  const { snapshot, goHome, showToast } = useApp()
  const [present, setPresent] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const revision = snapshot?.scannedAt

  useEffect(() => {
    if (slug !== EXAMPLE_SLUG) return
    let current = true
    void Promise.resolve()
      .then(() => window.qa.examplePresent())
      .then(
        (value) => current && setPresent(value),
        () => current && setPresent(false)
      )
    return () => {
      current = false
    }
  }, [slug, revision])

  if (slug !== EXAMPLE_SLUG || !present) return null

  const remove = (): void => {
    setBusy(true)
    void window.qa
      .removeExample()
      .then((result) => {
        if (result.kind === 'removed') {
          showToast('Example project removed')
          goHome()
        } else {
          showToast(exampleRemoveMessage(result.reason))
          setConfirming(false)
        }
      })
      .catch(() => showToast(exampleRemoveMessage('remove-failed')))
      .finally(() => setBusy(false))
  }

  if (confirming) {
    return (
      <div className="exbar confirm" role="alertdialog" aria-label="Remove the example project">
        <span className="grow">
          <b>Remove the example project?</b> This deletes the {EXAMPLE_SLUG} folder from your
          records folder. Nothing else is touched.
        </span>
        <span className="exbar-acts">
          <button
            type="button"
            className="ghostbtn"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button type="button" className="danger" disabled={busy} onClick={remove} autoFocus>
            Remove
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className="exbar" role="note">
      <span className="grow">
        <b>This is the example project.</b> Your own projects appear here once your agents file
        requests.
      </span>
      <button type="button" className="ghostbtn" onClick={() => setConfirming(true)}>
        Remove example
      </button>
    </div>
  )
}
