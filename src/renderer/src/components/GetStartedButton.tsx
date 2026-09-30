import { useState } from 'react'
import { Plug, Trash2 } from 'lucide-react'
import { useApp } from '../state/app'
import { EXAMPLE_SLUG, exampleRemoveMessage } from '../lib/getStarted'
import { getStartedButtonState, refreshExample, useExamplePresent } from '../lib/exampleState'

/**
 * The title bar's first-run button (ticket 36): "Get started" until the example
 * project is opened, "Remove example" while it exists, then gone for good (the
 * retired flag lives in settings). Removal asks inside the window and goes
 * through main, which keeps ticket 34's marker check and confinement.
 */
export function GetStartedButton(): React.JSX.Element | null {
  const { settings, scope, navigate, goHome, changeSetting, showToast } = useApp()
  const present = useExamplePresent()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const state = getStartedButtonState(settings?.getStartedRetired, present)

  if (state === 'hidden') return null

  const remove = (): void => {
    setBusy(true)
    void window.qa
      .removeExample()
      .then((result) => {
        if (result.kind === 'removed') {
          changeSetting('getStartedRetired', true)
          showToast('Example project removed')
          if (scope.kind === 'project' && scope.slug === EXAMPLE_SLUG) goHome()
        } else {
          showToast(exampleRemoveMessage(result.reason))
        }
      })
      .catch(() => showToast(exampleRemoveMessage('remove-failed')))
      .finally(() => {
        setBusy(false)
        setConfirming(false)
        void refreshExample()
      })
  }

  return (
    <>
      {state === 'get-started' ? (
        <button
          type="button"
          className="gsbtn"
          title="Get started: connect your agents"
          onClick={() => navigate({ kind: 'get-started' })}
        >
          <Plug className="ic" strokeWidth={2} />
          <span>Get started</span>
        </button>
      ) : (
        <button
          type="button"
          className="gsbtn"
          title="Remove the example project"
          aria-expanded={confirming}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="ic" strokeWidth={2} />
          <span>Remove example</span>
        </button>
      )}
      {confirming && (
        <div className="gs-confirm" role="alertdialog" aria-label="Remove the example project">
          <p>
            <b>Remove the example project?</b> This deletes the {EXAMPLE_SLUG} folder from your
            records folder. Nothing else is touched.
          </p>
          <div className="gs-confirm-acts">
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
          </div>
        </div>
      )}
    </>
  )
}
