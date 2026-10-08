import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RotateCcw, Search } from 'lucide-react'
import { useApp } from '../state/app'
import type { Settings as SettingsType, SettingsChange } from '../../../shared/ipc'
import { COMMANDS } from '../commands/registry'
import { displayChord, effectiveBindings } from '../commands/keymap'
import { useCommandScope } from '../commands/provider'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Human labels for every current key. Historical entries for retired keys fall
// back to the raw key so removing a setting never makes its history unreadable.
const KEY_NAME: Record<keyof SettingsType, string> = {
  qaRepoPath: 'Record folder',
  appearance: 'Appearance',
  readingTextSize: 'Request text size',
  pinBehaviour: 'Pin behaviour',
  pinned: 'Pin state',
  dockBadge: 'Dock badge',
  runnerMode: 'Runner layout',
  widthPreset: 'Window width',
  windowMode: 'Window placement',
  verdictLayout: 'Verdict sheet layout',
  reviewMargin: 'Review margin',
  keymap: 'Keyboard shortcuts',
  getStartedRetired: 'Get started button hidden'
}

function keyName(key: string): string {
  return KEY_NAME[key as keyof SettingsType] ?? key
}

function isSettingsKey(key: string, settings: SettingsType): key is keyof SettingsType {
  return Object.prototype.hasOwnProperty.call(settings, key)
}

/** The value a change or a control shows for a given key. */
function displayVal(key: string, value: unknown): string {
  switch (key) {
    case 'dockBadge':
    case 'pinned':
    case 'getStartedRetired':
      return value ? 'On' : 'Off'
    case 'appearance':
      return { light: 'Light', dark: 'Dark', system: 'System' }[String(value)] ?? String(value)
    case 'readingTextSize':
      return (
        { normal: 'Normal', large: 'Large', 'extra-large': 'Extra large' }[String(value)] ??
        String(value)
      )
    case 'pinBehaviour':
      return (
        { remember: 'Remember last', always: 'Always start pinned' }[String(value)] ?? String(value)
      )
    case 'runnerMode':
      return { focus: 'Focus', list: 'List' }[String(value)] ?? String(value)
    case 'widthPreset':
      return { narrow: 'Narrow', wide: 'Wide' }[String(value)] ?? String(value)
    case 'windowMode':
      return { free: 'Free', docked: 'Docked' }[String(value)] ?? String(value)
    case 'verdictLayout':
      return { one: 'One at a time', all: 'All at once' }[String(value)] ?? String(value)
    case 'reviewMargin':
      return (
        { auto: 'Auto', open: 'Always open', collapsed: 'Collapsed' }[String(value)] ??
        String(value)
      )
    case 'keymap': {
      const count = value && typeof value === 'object' ? Object.keys(value).length : 0
      return `${count} shortcut override${count === 1 ? '' : 's'}`
    }
    default:
      return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  }
}

/** `D Mon HH:MM` from an ISO stamp; the raw value when it will not parse. */
function formatChangeTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`
}

function matches(haystack: string, query: string): boolean {
  return !query || haystack.toLowerCase().includes(query)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]))
    )
  }
  if (
    typeof left === 'object' &&
    left !== null &&
    !Array.isArray(left) &&
    typeof right === 'object' &&
    right !== null &&
    !Array.isArray(right)
  ) {
    const entries = Object.entries(left)
    const other = right as Record<string, unknown>
    return (
      entries.length === Object.keys(other).length &&
      entries.every(
        ([key, value]) =>
          Object.prototype.hasOwnProperty.call(other, key) && valuesEqual(value, other[key])
      )
    )
  }
  return false
}

/**
 * Settings: a searchable list plus the settings changelog. The record-path row
 * re-points the live watcher; the changelog renders newest-first with a per-entry
 * Reset that appends a reversal change (never deletes history). Appearance is
 * excluded by design (light-only).
 */
export function Settings(): React.JSX.Element {
  const {
    settings,
    changeSetting,
    setPinned,
    setWidthPreset,
    setWindowMode,
    back,
    openCommandPalette,
    reloadSettings,
    navigate
  } = useApp()
  const [query, setQuery] = useState('')
  const [pathError, setPathError] = useState<string | null>(null)
  const [log, setLog] = useState<SettingsChange[]>([])
  const [version, setVersion] = useState('')

  // Re-pull the log whenever settings change so a Reset's reversal appears at once.
  useEffect(() => {
    void window.qa.getSettingsLog().then(setLog)
  }, [settings])

  useEffect(() => {
    let current = true
    void window.qa
      .getVersion()
      .then((runningVersion) => current && setVersion(runningVersion))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [])

  const q = query.trim().toLowerCase()

  // Main refuses a record folder that was not just picked in this window's
  // folder dialog (or is not one the app has used before); the refusal, like
  // any failure to re-point, is shown here rather than swallowed.
  const setRecordFolder = async (value: string): Promise<void> => {
    setPathError(null)
    try {
      await window.qa.setSetting('qaRepoPath', value)
      reloadSettings()
    } catch {
      setPathError('Could not use that folder. Choose it again, then try again.')
    }
  }

  const changePath = async (): Promise<void> => {
    const picked = await window.qa.pickFolder()
    if (!picked || !settings || picked === settings.qaRepoPath) return
    await setRecordFolder(picked)
  }

  // Window keys carry a main-process side effect (resize/dock), so a changelog
  // Reset must route through their dedicated actions, not the plain setSetting.
  const resetKey = <K extends keyof SettingsType>(key: K, value: SettingsType[K]): void => {
    if (key === 'pinned') setPinned(value as SettingsType['pinned'])
    else if (key === 'widthPreset') setWidthPreset(value as SettingsType['widthPreset'])
    else if (key === 'windowMode') setWindowMode(value as SettingsType['windowMode'])
    else if (key === 'qaRepoPath') void setRecordFolder(value as SettingsType['qaRepoPath'])
    else changeSetting(key, value)
  }

  useCommandScope(
    settings
      ? {
          'settings.change-folder': () => void changePath(),
          'settings.text-size-normal': () => changeSetting('readingTextSize', 'normal'),
          'settings.text-size-large': () => changeSetting('readingTextSize', 'large'),
          'settings.text-size-extra-large': () => changeSetting('readingTextSize', 'extra-large'),
          'settings.pin-remember': () => changeSetting('pinBehaviour', 'remember'),
          'settings.pin-always': () => changeSetting('pinBehaviour', 'always'),
          'settings.toggle-dock-badge': () => changeSetting('dockBadge', !settings.dockBadge),
          'settings.width-narrow': () => setWidthPreset('narrow'),
          'settings.width-wide': () => setWidthPreset('wide'),
          'settings.window-free': () => setWindowMode('free'),
          'settings.window-docked': () => setWindowMode('docked'),
          'settings.open-keymap-palette': () => openCommandPalette('all')
        }
      : {}
  )

  // Newest-first render; data on disk stays chronological.
  const shownLog = useMemo(() => {
    return [...log]
      .reverse()
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) =>
        matches(
          `${keyName(entry.key)} ${displayVal(entry.key, entry.from)} ${displayVal(entry.key, entry.to)}`,
          q
        )
      )
  }, [log, q])

  if (!settings) {
    return (
      <div className="view">
        <div className="vhead">
          <span className="vt">Settings</span>
          <span className="grow" />
        </div>
      </div>
    )
  }

  const keymap =
    settings.keymap && typeof settings.keymap === 'object' && !Array.isArray(settings.keymap)
      ? settings.keymap
      : {}

  const keymapRows = COMMANDS.filter((command) => {
    const bindings = effectiveBindings(command, keymap).map(displayChord).join(' ')
    return matches(`${command.title} ${command.section} ${bindings}`, q)
  })

  const rowVisible = {
    repo: matches(`record folder ${settings.qaRepoPath} change folder`, q),
    textSize: matches('request text size normal large extra large reading font', q),
    pin: matches('pin behaviour remember last always start pinned window on top', q),
    badge: matches('dock badge waiting count on off', q),
    width: matches('window width narrow wide reading strip', q),
    placement: matches('window placement free docked right dock edge screen', q),
    getStarted: matches('get started connect agents example project button show again hide', q),
    version: matches(`version running build ${version}`, q),
    keymap:
      matches('keyboard shortcuts keymap command palette bindings', q) || keymapRows.length > 0
  }
  const anyRow =
    rowVisible.repo ||
    rowVisible.textSize ||
    rowVisible.pin ||
    rowVisible.badge ||
    rowVisible.width ||
    rowVisible.placement ||
    rowVisible.getStarted ||
    rowVisible.version ||
    rowVisible.keymap

  return (
    <div className="view">
      <div className="vhead">
        <button className="backbtn" aria-label="Back" onClick={back}>
          <ArrowLeft className="ic" strokeWidth={2} />
        </button>
        <span className="vt">Settings</span>
        <span className="grow" />
      </div>

      <div className="scroll">
        <div className="searchbox">
          <Search className="ic s" strokeWidth={2} />
          <input
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {rowVisible.repo && (
          <div className="setrow">
            <div className="sname">Record folder</div>
            <div className="sdesc">The only folder Dev Traffic Control reads or writes</div>
            <div className="sctl">
              <span className="pathval mono">{settings.qaRepoPath}</span>
              <button className="outbtn sm" onClick={() => void changePath()}>
                Change…
              </button>
            </div>
            {pathError && (
              <div className="sdesc" role="alert">
                {pathError}
              </div>
            )}
          </div>
        )}

        {rowVisible.textSize && (
          <div className="setrow">
            <div className="sname">Request text size</div>
            <div className="sdesc">Intro, check, and document text without changing controls</div>
            <div className="sctl">
              <div className="wseg" role="group" aria-label="Request text size">
                <button
                  className={settings.readingTextSize === 'normal' ? 'on' : ''}
                  aria-pressed={settings.readingTextSize === 'normal'}
                  onClick={() => changeSetting('readingTextSize', 'normal')}
                >
                  Normal
                </button>
                <button
                  className={settings.readingTextSize === 'large' ? 'on' : ''}
                  aria-pressed={settings.readingTextSize === 'large'}
                  onClick={() => changeSetting('readingTextSize', 'large')}
                >
                  Large
                </button>
                <button
                  className={settings.readingTextSize === 'extra-large' ? 'on' : ''}
                  aria-pressed={settings.readingTextSize === 'extra-large'}
                  onClick={() => changeSetting('readingTextSize', 'extra-large')}
                >
                  Extra large
                </button>
              </div>
            </div>
          </div>
        )}

        {rowVisible.pin && (
          <div className="setrow">
            <div className="sname">Pin behaviour</div>
            <div className="sdesc">How the window starts</div>
            <div className="sctl">
              <div className="wseg" role="group" aria-label="Pin behaviour">
                <button
                  className={settings.pinBehaviour === 'remember' ? 'on' : ''}
                  aria-pressed={settings.pinBehaviour === 'remember'}
                  onClick={() => changeSetting('pinBehaviour', 'remember')}
                >
                  Remember last
                </button>
                <button
                  className={settings.pinBehaviour === 'always' ? 'on' : ''}
                  aria-pressed={settings.pinBehaviour === 'always'}
                  onClick={() => changeSetting('pinBehaviour', 'always')}
                >
                  Always start pinned
                </button>
              </div>
            </div>
          </div>
        )}

        {rowVisible.badge && (
          <div className="setrow">
            <div className="sname">Dock badge</div>
            <div className="sdesc">Waiting count on the Dock icon</div>
            <div className="sctl">
              <button
                className={`switch${settings.dockBadge ? ' on' : ''}`}
                role="switch"
                aria-checked={settings.dockBadge}
                aria-label="Dock badge"
                onClick={() => changeSetting('dockBadge', !settings.dockBadge)}
              >
                <i />
              </button>
              <span className="swlbl">{settings.dockBadge ? 'On' : 'Off'}</span>
            </div>
          </div>
        )}

        {rowVisible.width && (
          <div className="setrow">
            <div className="sname">Window width</div>
            <div className="sdesc">A narrow strip beside the app, or a wide frame for reading</div>
            <div className="sctl">
              <div className="wseg" role="group" aria-label="Window width">
                <button
                  className={settings.widthPreset === 'narrow' ? 'on' : ''}
                  aria-pressed={settings.widthPreset === 'narrow'}
                  onClick={() => setWidthPreset('narrow')}
                >
                  Narrow
                </button>
                <button
                  className={settings.widthPreset === 'wide' ? 'on' : ''}
                  aria-pressed={settings.widthPreset === 'wide'}
                  onClick={() => setWidthPreset('wide')}
                >
                  Wide
                </button>
              </div>
            </div>
          </div>
        )}

        {rowVisible.placement && (
          <div className="setrow">
            <div className="sname">Window placement</div>
            <div className="sdesc">
              Float freely, or stay docked at the edge the Dock button last used
            </div>
            <div className="sctl">
              <div className="wseg" role="group" aria-label="Window placement">
                <button
                  className={settings.windowMode === 'free' ? 'on' : ''}
                  aria-pressed={settings.windowMode === 'free'}
                  onClick={() => setWindowMode('free')}
                >
                  Free
                </button>
                <button
                  className={settings.windowMode === 'docked' ? 'on' : ''}
                  aria-pressed={settings.windowMode === 'docked'}
                  onClick={() => setWindowMode('docked')}
                >
                  Docked
                </button>
              </div>
            </div>
          </div>
        )}

        {rowVisible.getStarted && (
          <div className="setrow">
            <div className="sname">Get started</div>
            <div className="sdesc">
              Connect your agents, or look around the example project. The title-bar button
              {settings.getStartedRetired ? ' is hidden' : ' shows until the example is removed'}.
            </div>
            <div className="sctl">
              <button className="outbtn sm" onClick={() => navigate({ kind: 'get-started' })}>
                Get started
              </button>
              {settings.getStartedRetired && (
                <button
                  className="outbtn sm"
                  onClick={() => changeSetting('getStartedRetired', false)}
                >
                  Show the button again
                </button>
              )}
            </div>
          </div>
        )}

        {rowVisible.version && version && (
          <div className="setrow">
            <div className="sname">Version</div>
            <div className="sdesc">Reported by the running build</div>
            <div className="sctl">
              <span className="mono">{version}</span>
            </div>
          </div>
        )}

        {rowVisible.keymap && (
          <section className="keymap-settings" aria-labelledby="keymap-settings-title">
            <div className="keymap-settings-head">
              <div>
                <h2 id="keymap-settings-title">Keyboard shortcuts</h2>
                <p>Current effective bindings. Change them in the command palette.</p>
              </div>
              <button
                className="outbtn sm"
                aria-label="Change shortcuts in the command palette"
                onClick={() => openCommandPalette('all')}
              >
                Open palette
              </button>
            </div>
            <div className="keymap-settings-list">
              {keymapRows.map((command) => {
                const bindings = effectiveBindings(command, keymap)
                const overridden = Object.prototype.hasOwnProperty.call(keymap, command.id)
                return (
                  <div
                    className="keymap-settings-row"
                    key={command.id}
                    data-testid={`keymap:${command.id}`}
                  >
                    <span className="keymap-settings-title">{command.title}</span>
                    <span className="keymap-settings-section">{command.section}</span>
                    {overridden && <span className="keymap-settings-changed">Changed</span>}
                    <span className="keymap-settings-binding">
                      {bindings.length ? bindings.map(displayChord).join(' · ') : 'Unbound'}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {!anyRow && <div className="nomatch">No settings match.</div>}

        <div className="lbl setclog-lbl">Settings changelog</div>
        {shownLog.map(({ entry, i }) => {
          const currentKey = isSettingsKey(entry.key, settings) ? entry.key : null
          const canReset = currentKey !== null && !valuesEqual(settings[currentKey], entry.from)
          const name = keyName(entry.key)
          return (
            <div className="clogrow" key={`${entry.key}:${entry.at}:${i}`}>
              <div className="cbody">
                <div className="cname">{name}</div>
                <div className="cchange">
                  <span className="old">{displayVal(entry.key, entry.from)}</span>
                  <span className="arr">→</span>
                  <span className="new">{displayVal(entry.key, entry.to)}</span>
                </div>
              </div>
              <div className="cright">
                <span className="cwhen">{formatChangeTime(entry.at)}</span>
                <button
                  className="resetbtn"
                  disabled={!canReset}
                  aria-label={`Reset ${name} to ${displayVal(entry.key, entry.from)}`}
                  onClick={() => {
                    if (currentKey !== null) {
                      resetKey(currentKey, entry.from as SettingsType[typeof currentKey])
                    }
                  }}
                >
                  <RotateCcw className="ic" strokeWidth={2} />
                  Reset
                </button>
              </div>
            </div>
          )
        })}
        {log.length > 0 && shownLog.length === 0 && (
          <div className="nomatch">No changes match.</div>
        )}
        {log.length === 0 && <div className="nomatch">No changes yet.</div>}
      </div>
    </div>
  )
}
