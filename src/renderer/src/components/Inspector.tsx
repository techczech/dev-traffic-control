import { PanelRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RecordFileContent } from '../../../shared/ipc'

export type InspectorTarget =
  { kind: 'run'; path: string } | { kind: 'thread'; id: string; files: string[] }

function reportPath(requestPath: string): string {
  return requestPath.replace(/\.md$/, '.report.json')
}

function relativePath(file: string, root: string | undefined): string {
  if (!root || !file.startsWith(root)) return file
  return file.slice(root.length).replace(/^\//, '')
}

export function Inspector({
  target,
  revision,
  root,
  onClose
}: {
  target: InspectorTarget
  revision: string
  root?: string
  onClose: () => void
}): React.JSX.Element {
  const files = useMemo(
    () => (target.kind === 'run' ? [target.path, reportPath(target.path)] : target.files),
    [target]
  )
  const [contents, setContents] = useState<RecordFileContent[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    let current = true
    void window.qa.readRecordFiles(files).then((next) => {
      if (current) setContents(next)
    })
    return () => {
      current = false
    }
  }, [files, revision])

  const shown = contents[Math.min(active, Math.max(contents.length - 1, 0))]
  return (
    <aside className="insp" aria-label="Inspector">
      <div className="insphead">
        <PanelRight size={14} strokeWidth={2} />
        <span className="t">Inspector</span>
        <button className="iconbtn" aria-label="Close inspector" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {target.kind === 'run' ? (
        <div className="insptabs">
          <button className={active === 0 ? 'on' : ''} onClick={() => setActive(0)}>
            Request
          </button>
          <button className={active === 1 ? 'on' : ''} onClick={() => setActive(1)}>
            report.json
          </button>
        </div>
      ) : (
        <div className="inspthreadtitle">{target.files.length} entry files · oldest first</div>
      )}
      <div className="inspbody">
        {target.kind === 'thread' ? (
          contents.map((file) => (
            <section className="inspfile" key={file.file}>
              <div className="fpath">{relativePath(file.file, root)}</div>
              <pre>{file.content ?? 'File is not available.'}</pre>
            </section>
          ))
        ) : (
          <>
            <div className="fpath">{shown ? relativePath(shown.file, root) : files[active]}</div>
            <pre>
              {shown?.content ?? (active === 1 ? 'No report.json yet.' : 'File is not available.')}
            </pre>
          </>
        )}
      </div>
    </aside>
  )
}
