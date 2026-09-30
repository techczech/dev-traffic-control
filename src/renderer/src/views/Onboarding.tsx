import { useCallback, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useApp } from '../state/app'
import { useCommandScope } from '../commands/provider'
import { tildePath } from '../../../shared/tildePath'

/**
 * First-run onboarding: one designed panel that offers the default record path
 * and creates it through the app's own bootstrap (never a hand-crafted contract).
 * It disappears the moment the watcher reports a resolving root, so no explicit
 * navigation is needed — the App gate simply stops rendering it.
 */
export function Onboarding(): React.JSX.Element {
  const { settings, reloadSettings } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bootstrap = useCallback(
    async (root: string) => {
      setBusy(true)
      setError(null)
      try {
        // null: main refused a folder that is neither the current root nor
        // the one just picked in the folder dialog. Nothing was written.
        if (!(await window.qa.bootstrapRepo(root))) {
          setError('Could not use that folder. Choose it again, then try again.')
          return
        }
        reloadSettings()
      } catch {
        setError('Could not use that folder. Check that it can be read, then try again.')
      } finally {
        setBusy(false)
      }
    },
    [reloadSettings]
  )

  const acceptDefault = useCallback(() => {
    if (settings) void bootstrap(settings.qaRepoPath)
  }, [settings, bootstrap])

  const chooseAnother = useCallback(async () => {
    const picked = await window.qa.pickFolder()
    if (picked) await bootstrap(picked)
  }, [bootstrap])

  useCommandScope({
    'onboarding.accept-default': { enabled: !busy, handler: acceptDefault },
    'onboarding.choose-folder': { enabled: !busy, handler: () => void chooseAnother() }
  })

  const defaultPath = settings?.qaRepoPath
    ? tildePath(settings.qaRepoPath)
    : '~/Documents/Dev Traffic Control'

  return (
    <div className="view">
      <div className="empty onboard">
        <div className="motif" aria-hidden="true">
          <i />
          <i />
          <i />
          <FolderOpen className="ic" strokeWidth={2} />
        </div>
        <h2>Set up your records folder</h2>
        <p>Dev Traffic Control watches one folder for the requests your agents write.</p>
        <span className="pathval mono" title={settings?.qaRepoPath}>
          {defaultPath}
        </span>
        <p className="onboard-more">
          The folder holds Markdown files your agents write, one per request. It can be a git
          repository.
        </p>
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <button className="primbtn" disabled={busy} onClick={acceptDefault}>
            Use this
          </button>
          <button className="secbtn" disabled={busy} onClick={() => void chooseAnother()}>
            <FolderOpen className="ic" strokeWidth={2} />
            Choose another folder…
          </button>
        </div>
      </div>
    </div>
  )
}
