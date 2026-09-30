import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Image as ImageIcon,
  Link2,
  RotateCw,
  Send,
  TriangleAlert,
  X
} from 'lucide-react'
import { useApp } from '../state/app'
import { blobToPngBase64, firstImageFile } from '../lib/imageToPng'
import { formatClock } from '../lib/format'
import type { NoteDoc } from '../../../shared/ipc'
import { useCommandScope } from '../commands/provider'

function noteBasename(p: string): string {
  return p.split('/').pop() ?? p
}
function stripMd(name: string): string {
  return name.replace(/\.md$/, '')
}
function hasContent(d: NoteDoc): boolean {
  return d.title.trim() !== '' || d.body.trim() !== '' || d.shots.length > 0
}

/**
 * The Note editor: free-form feedback authored in the app (ADR-0003). Notes are
 * created lazily — nothing hits disk until the first meaningful content — and
 * autosave carries the same debounced-write + unmount-flush pattern as the
 * Runner (a lost-at-the-boundary save once ate real data). Draft ↔ handed-over
 * mirrors finish/reopen exactly; handed-over notes render read-only.
 */
export function NoteEditor({
  existingPath,
  newIn,
  linkedRun,
  fromRun
}: {
  existingPath?: string
  newIn?: string
  linkedRun?: string
  fromRun?: string
}): React.JSX.Element {
  const { back, snapshot, showToast, helpOpen, switcherOpen, openLinkSwitcher } = useApp()

  // A new note starts as an in-memory draft (nothing on disk yet); an existing
  // note loads asynchronously below. Keyed by path/newIn in App, so this mounts
  // fresh per note.
  const initialDraft: NoteDoc | null = existingPath
    ? null
    : { path: '', title: '', body: '', linkedRun, shots: [] }
  const [doc, setDoc] = useState<NoteDoc | null>(initialDraft)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const docRef = useRef<NoteDoc | null>(initialDraft)
  const dirtyRef = useRef(false)
  const creatingRef = useRef<Promise<string> | null>(null)
  const [rev, setRev] = useState(0)

  const readOnly = !!doc?.handedOverAt

  // Load an existing note (the new-note draft is already initialised above).
  useEffect(() => {
    if (!existingPath) return
    let cancelled = false
    window.qa
      .openNote(existingPath)
      .then((d) => {
        if (cancelled) return
        // null: main refused the path (not a note inside the record root).
        if (!d) {
          showToast('Could not open this note')
          return
        }
        docRef.current = d
        setDoc(d)
      })
      .catch(() => {
        if (!cancelled) showToast('Could not open this note')
      })
    return () => {
      cancelled = true
    }
  }, [existingPath, showToast])

  // Lazy create, once. Guarded so paste + autosave racing don't create twice.
  const ensureCreated = useCallback((): Promise<string> => {
    const cur = docRef.current
    if (cur?.path) return Promise.resolve(cur.path)
    if (!creatingRef.current) {
      creatingRef.current = (async () => {
        const created = await window.qa.createNote(newIn ?? '', docRef.current?.title ?? '')
        if (!created) {
          // Refused by main: nothing was written. Let a later save try again.
          creatingRef.current = null
          throw new Error('Could not create the note')
        }
        const merged: NoteDoc = { ...(docRef.current as NoteDoc), path: created.path }
        docRef.current = merged
        setDoc(merged)
        // A from-run note earns its place in the report's noteFiles on creation.
        if (fromRun) await window.qa.linkNoteToReport(fromRun, noteBasename(created.path))
        return created.path
      })()
    }
    return creatingRef.current
  }, [newIn, fromRun])

  const doSave = useCallback(
    async (snap: NoteDoc) => {
      try {
        let s = snap
        if (!s.path) {
          if (!hasContent(s)) return // nothing worth a file yet — stay lazy
          const p = await ensureCreated()
          s = { ...s, path: p }
        }
        const saved = await window.qa.saveNote(s)
        if (!saved) throw new Error('Could not save the note')
        setSavedAt(saved.savedAt)
        setSaveError(false)
      } catch {
        setSaveError(true)
      }
    },
    [ensureCreated]
  )

  // Debounced autosave: every mutation bumps `rev`; only the last timer survives.
  useEffect(() => {
    if (rev === 0) return
    dirtyRef.current = true
    const snap = docRef.current
    if (!snap) return
    const timer = setTimeout(() => {
      dirtyRef.current = false
      void doSave(snap)
    }, 400)
    return () => clearTimeout(timer)
  }, [rev, doSave])

  // Flush at the switch boundary: unmount cancels the pending debounce, so a
  // mutation made within the last 400 ms would silently never reach disk. This
  // is the Runner's guard verbatim — a lost boundary save once emptied a real
  // outline; the driver will mutate then Esc instantly.
  useEffect(() => {
    return () => {
      if (dirtyRef.current && docRef.current) {
        dirtyRef.current = false
        void doSave(docRef.current)
      }
    }
  }, [doSave])

  // The single mutation channel — every note change flows through here.
  const mutate = useCallback((producer: (d: NoteDoc) => NoteDoc) => {
    const prev = docRef.current
    if (!prev || prev.handedOverAt) return
    const next = producer(prev)
    if (next === prev) return
    docRef.current = next
    setDoc(next)
    setRev((r) => r + 1)
  }, [])

  const ingestShot = useCallback(
    async (file: File | null) => {
      if (!file || docRef.current?.handedOverAt) return
      const base64 = await blobToPngBase64(file)
      if (!base64) {
        showToast('That image could not be read')
        return
      }
      try {
        const p = await ensureCreated()
        const rel = await window.qa.addNoteShot(p, base64)
        if (!rel) throw new Error('Could not add the screenshot')
        mutate((d) => ({ ...d, shots: [...d.shots, rel] }))
      } catch {
        showToast('That image could not be read')
      }
    },
    [ensureCreated, mutate, showToast]
  )

  // Paste anywhere in the editor attaches a screenshot (ADR-0004: ⌘V).
  useEffect(() => {
    if (readOnly) return
    function onPaste(e: ClipboardEvent): void {
      const file = firstImageFile(e.clipboardData?.items ?? null)
      if (!file) return
      e.preventDefault()
      void ingestShot(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [readOnly, ingestShot])

  const doHandOver = useCallback(async () => {
    try {
      dirtyRef.current = false
      const p = await ensureCreated()
      // Flush latest content first; a refused save must not be followed by a hand-over.
      const saved = await window.qa.saveNote({ ...(docRef.current as NoteDoc), path: p })
      if (!saved) throw new Error('Could not save the note')
      const stamped = await window.qa.handOverNote(p)
      if (!stamped) throw new Error('Could not hand over the note')
      docRef.current = stamped
      setDoc(stamped)
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }, [ensureCreated])

  const doReopen = useCallback(async () => {
    const cur = docRef.current
    if (!cur?.path) return
    try {
      const cleared = await window.qa.reopenNote(cur.path)
      if (!cleared) throw new Error('Could not reopen the note')
      docRef.current = cleared
      setDoc(cleared)
    } catch {
      setSaveError(true)
    }
  }, [])

  const onLinkRun = useCallback(() => {
    if (docRef.current?.handedOverAt) return
    openLinkSwitcher((run) => {
      mutate((d) => ({ ...d, linkedRun: noteBasename(run.request.path) }))
    })
  }, [openLinkSwitcher, mutate])

  const commandEnabled = !helpOpen && !switcherOpen
  const handedOver = !!doc?.handedOverAt
  useCommandScope({
    'note.hand-over': {
      enabled: commandEnabled && !handedOver,
      handler: () => void doHandOver()
    },
    'note.link-run': {
      enabled: commandEnabled && !handedOver,
      handler: onLinkRun
    },
    'note.reopen': {
      enabled: commandEnabled && handedOver,
      handler: () => void doReopen()
    },
    'note.remove-link': {
      enabled: commandEnabled && !!doc?.linkedRun && !handedOver,
      handler: () => mutate((current) => ({ ...current, linkedRun: undefined }))
    },
    'note.retry-save': {
      enabled: commandEnabled && saveError && !!doc,
      handler: () => {
        const current = docRef.current ?? doc
        if (current) void doSave(current)
      }
    },
    'note.paste-screenshot': {
      enabled: commandEnabled && !handedOver,
      preventDefault: false,
      handler: () => showToast('Paste a screenshot with ⌘V')
    }
  })

  const linkedRunLabel = useMemo(() => {
    const lr = doc?.linkedRun
    if (!lr) return null
    const run = snapshot?.runs.find((r) => noteBasename(r.request.path) === lr)
    return run ? run.request.title : stripMd(lr)
  }, [doc?.linkedRun, snapshot])

  if (!doc) {
    return (
      <div className="view">
        <div className="vhead">
          <span className="vt">Opening note…</span>
          <span className="grow" />
        </div>
      </div>
    )
  }

  const linkRow = doc.linkedRun ? (
    <span className={`linkchip${readOnly ? ' noremove' : ''}`}>
      <Link2 className="ic s" strokeWidth={2} />
      {linkedRunLabel}
      {!readOnly && (
        <button
          className="qx"
          aria-label="Remove linked run"
          onClick={() => mutate((d) => ({ ...d, linkedRun: undefined }))}
        >
          <X className="ic" strokeWidth={2} />
        </button>
      )}
    </span>
  ) : readOnly ? null : (
    <button className="linklater" onClick={onLinkRun}>
      <Link2 className="ic s" strokeWidth={2} />
      Link a run
      <kbd>R</kbd>
    </button>
  )

  return (
    <div className="view">
      <div className="vhead">
        <button className="backbtn" aria-label="Back" onClick={back}>
          <ArrowLeft className="ic" strokeWidth={2} />
        </button>
        <span className="vt">Note</span>
        <span className="grow" />
        {readOnly ? (
          <span className="badge handed">Handed over</span>
        ) : (
          <span className="badge draft">Draft</span>
        )}
      </div>

      {saveError && (
        <div className="banner" role="alert">
          <TriangleAlert className="ic" strokeWidth={2} />
          <span className="grow">Could not save the note</span>
          <button className="retry" onClick={() => void doSave(docRef.current ?? doc)}>
            <RotateCw className="ic s" strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      <div className="scroll">
        <div className="notebody">
          <input
            className="ntitle"
            value={doc.title}
            placeholder="Untitled note"
            aria-label="Note title"
            readOnly={readOnly}
            onChange={(e) => mutate((d) => ({ ...d, title: e.target.value }))}
          />
          {linkRow}
          <textarea
            className="nbody"
            data-source-file={doc.path || existingPath}
            value={doc.body}
            placeholder="Type your note — observations, ideas, reactions. Screenshots welcome."
            aria-label="Note body"
            readOnly={readOnly}
            onChange={(e) => mutate((d) => ({ ...d, body: e.target.value }))}
          />
          <div
            className={`dropzone${readOnly ? ' still' : ''}${dragOver ? ' dragover' : ''}`}
            onDragOver={(e) => {
              if (readOnly) return
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              setDragOver(false)
              if (readOnly) return
              e.preventDefault()
              void ingestShot(firstImageFileFromDrop(e.dataTransfer))
            }}
          >
            <NoteShots
              notePath={doc.path}
              shots={doc.shots}
              readOnly={readOnly}
              onZoom={(url, name) => setZoom({ url, name })}
              onRemove={(rel) => mutate((d) => ({ ...d, shots: d.shots.filter((s) => s !== rel) }))}
            />
            {!readOnly && (
              <div className="hint">
                <span>Drop screenshots here</span>
                <span>
                  or press <kbd>⌘V</kbd>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="notefoot">
        <span className="status">
          {readOnly
            ? 'handed over · read-only for the agent'
            : `draft · autosaved ${savedAt ? formatClock(savedAt) : '—'}`}
        </span>
        {readOnly ? (
          <>
            <span className="done-pill">
              <BadgeCheck className="ic s" strokeWidth={2} />
              Handed over {formatClock(doc.handedOverAt ?? null)}
            </span>
            <button className="ghostbtn" onClick={() => void doReopen()}>
              <RotateCw className="ic s" strokeWidth={2} />
              Reopen
            </button>
          </>
        ) : (
          <button className="primbtn" onClick={() => void doHandOver()}>
            <Send className="ic" strokeWidth={2} />
            Hand over
            <kbd>⇧H</kbd>
          </button>
        )}
      </div>

      {zoom && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot ${zoom.name}`}
          onClick={() => setZoom(null)}
        >
          <img className="zoomimg" src={zoom.url} alt={zoom.name} />
        </div>
      )}
    </div>
  )
}

function NoteShots({
  notePath,
  shots,
  readOnly,
  onZoom,
  onRemove
}: {
  notePath: string
  shots: string[]
  readOnly: boolean
  onZoom: (url: string, name: string) => void
  onRemove: (rel: string) => void
}): React.JSX.Element {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    for (const rel of shots) {
      if (urls[rel] || !notePath) continue
      void window.qa
        .readShot(notePath, rel)
        .then((u) => {
          if (!cancelled) setUrls((prev) => (prev[rel] ? prev : { ...prev, [rel]: u }))
        })
        .catch(() => {
          /* a missing shot keeps its placeholder */
        })
    }
    return () => {
      cancelled = true
    }
  }, [shots, notePath, urls])

  return (
    <>
      {shots.map((rel) => {
        const name = rel.split('/').pop() ?? rel
        const url = urls[rel]
        return (
          <div className="thumb" key={rel}>
            <div className="thumbwrap">
              <button
                className="ph"
                aria-label={`Zoom ${name}`}
                onClick={() => url && onZoom(url, name)}
              >
                {url ? <img src={url} alt={name} /> : <ImageIcon className="ic" strokeWidth={2} />}
              </button>
              {!readOnly && (
                <button
                  className="thumbx"
                  aria-label={`Remove ${name}`}
                  onClick={() => onRemove(rel)}
                >
                  <X className="ic" strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="fn" title={name}>
              {name}
            </div>
          </div>
        )
      })}
    </>
  )
}

/** First image blob out of a drop transfer, if any. */
function firstImageFileFromDrop(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
