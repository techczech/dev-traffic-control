import { useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, Check, CirclePlay, Copy, ExternalLink, Plug } from 'lucide-react'
import { useApp } from '../state/app'
import {
  EXAMPLE_SLUG,
  INSTALL_LINE,
  SKILL_URL,
  exampleRefusalMessage,
  setupLine
} from '../lib/getStarted'

/** A copyable line; the button says Copied for a moment after it worked. */
function CopyLine({ text, label }: { text: string; label: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const copy = (): void => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setState('copied'),
        () => setState('failed')
      )
      .finally(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setState('idle'), 1600)
      })
  }
  return (
    <div className="gs-code">
      <code>{text}</code>
      <button
        type="button"
        className={`gs-copy${state === 'copied' ? ' done' : ''}`}
        aria-label={label}
        onClick={copy}
      >
        {state === 'copied' ? (
          <Check className="ic" strokeWidth={2} />
        ) : (
          <Copy className="ic" strokeWidth={2} />
        )}
        <span aria-live="polite">
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Not copied' : 'Copy'}
        </span>
      </button>
    </div>
  )
}

/**
 * Get started (ticket 34, drawing `empty-b-get-started`): the three steps that
 * connect a new user's agents, then what those agents can send. Reached from
 * the DTC Dash, Help, the empty Inbox and the command palette.
 */
export function GetStarted(): React.JSX.Element {
  const { snapshot, settings, openProject, showToast } = useApp()
  const [opening, setOpening] = useState(false)
  const recordsFolder = snapshot?.root ?? settings?.qaRepoPath ?? '~/Documents/Dev Traffic Control'

  const openExample = (): void => {
    setOpening(true)
    void window.qa
      .openExample()
      .then((result) => {
        if (result.kind === 'refused') showToast(exampleRefusalMessage(result.reason))
        else openProject(result.slug)
      })
      .catch(() => showToast(exampleRefusalMessage('write-failed')))
      .finally(() => setOpening(false))
  }

  return (
    <div className="view gs-page">
      <div className="vhead">
        <Plug className="ic l" strokeWidth={2} />
        <span className="vt">Get started</span>
        <span className="grow" />
      </div>
      <div className="gs-col">
        <section className="gs-card" aria-label="Connect your agents">
          <h2>
            <Plug className="ic" strokeWidth={2} />
            Connect your agents
          </h2>
          <p className="sub">Three steps, once. After that your agents file requests here.</p>

          <div className="gs-step">
            <span className="gs-n">1</span>
            <div className="gs-b">
              <h3>Install the dev-traffic-control skill</h3>
              <p>
                It teaches your agent the request format. Any agent that reads skills can use it.
              </p>
              <a className="gs-link" href={SKILL_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="ic" strokeWidth={2} />
                <span>github.com/techczech/dominiks-agent-skills › dev/dev-traffic-control</span>
              </a>
              <CopyLine text={INSTALL_LINE} label="Copy the install line" />
            </div>
          </div>

          <div className="gs-step">
            <span className="gs-n">2</span>
            <div className="gs-b">
              <h3>Tell your agent where to write</h3>
              <p>Paste this to your agent once.</p>
              <CopyLine text={setupLine(recordsFolder)} label="Copy the setup line" />
            </div>
          </div>

          <div className="gs-step">
            <span className="gs-n">3</span>
            <div className="gs-b">
              <h3>Or look around first</h3>
              <p>
                The example project holds one check request, one design review and one handoff, so
                you can see what your agents will send.
              </p>
              <div className="gs-act">
                <button
                  type="button"
                  className="primbtn"
                  disabled={opening}
                  onClick={openExample}
                  title={`Adds ${EXAMPLE_SLUG} to your records folder`}
                >
                  <CirclePlay className="ic" strokeWidth={2} />
                  Open the example project
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="gs-send" aria-label="What agents can send you">
          <h2>What agents can send you</h2>
          <div className="gs-tiles">
            <div className="gs-tile">
              <div className="gs-pic" aria-hidden="true">
                <div className="ln">
                  <i className="v-pass" />
                  <b />
                </div>
                <div className="ln">
                  <i className="v-pass" />
                  <b className="s" />
                </div>
                <div className="ln">
                  <i className="v-fail" />
                  <b />
                </div>
                <div className="ln">
                  <i />
                  <b className="s" />
                </div>
              </div>
              <div>
                <h3>Check request</h3>
                <p>
                  A list of things to try in your app. You mark each one works, fails or skipped.
                </p>
              </div>
            </div>
            <div className="gs-tile">
              <div className="gs-pic row2" aria-hidden="true">
                <div className="sh">
                  <i className="a" />
                  <i />
                  <i />
                </div>
                <span className="dmd" />
                <div className="sh">
                  <i className="a wide" />
                  <i />
                  <i />
                </div>
              </div>
              <div>
                <h3>Design review</h3>
                <p>A document with pictures and decisions. You pick an option and can comment.</p>
              </div>
            </div>
            <div className="gs-tile">
              <div className="gs-pic" aria-hidden="true">
                <div className="hand">
                  <div className="card">
                    <i style={{ width: '70%' }} />
                    <i />
                    <i style={{ width: '50%' }} />
                  </div>
                  <ArrowRightLeft className="ic" strokeWidth={2} />
                  <div className="card">
                    <i style={{ width: '60%' }} />
                    <i />
                  </div>
                </div>
              </div>
              <div>
                <h3>Handoff</h3>
                <p>A note for the next session: where the work stands and what to do next.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
