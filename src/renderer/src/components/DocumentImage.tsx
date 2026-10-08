import { useEffect, useState } from 'react'
import { Image as ImageIcon, ImageOff } from 'lucide-react'

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function loadDocumentImageSource(
  cache: Map<string, Promise<string>>,
  requestPath: string,
  src: string
): Promise<string> {
  const key = `${requestPath}\u0000${src}`
  const cached = cache.get(key)
  if (cached) return cached
  const pending = Promise.resolve().then(() => window.qa.readShot(requestPath, src))
  cache.set(key, pending)
  void pending.catch(() => cache.delete(key))
  return pending
}

function LocalDocumentImage({
  cacheRef,
  requestPath,
  src,
  alt,
  className
}: {
  cacheRef: React.RefObject<Map<string, Promise<string>>>
  requestPath: string
  src: string
  alt: string
  className: string
}): React.JSX.Element {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const filename = basename(src)

  useEffect(() => {
    let current = true
    void loadDocumentImageSource(cacheRef.current, requestPath, src).then(
      (dataUrl) => {
        if (current) setResolvedSrc(dataUrl)
      },
      () => {
        if (current) setFailed(true)
      }
    )
    return () => {
      current = false
    }
  }, [cacheRef, requestPath, src])

  if (failed) {
    return (
      <div className="docimg-state failed" role="status">
        <ImageOff aria-hidden="true" strokeWidth={2} />
        <span>Could not load {filename}</span>
      </div>
    )
  }
  if (!resolvedSrc) {
    return (
      <div className="docimg-state">
        <ImageIcon aria-hidden="true" strokeWidth={2} />
        <span>Loading {filename}</span>
      </div>
    )
  }
  return <img className={className} src={resolvedSrc} alt={alt} />
}

/**
 * A document image: a data URL or web URL straight through, a local path read
 * through the main process (cached per request). `className` defaults to
 * `docimg`, the class the document's click-to-zoom listens for; the decision
 * card passes its own so its pictures enlarge inside the card instead.
 */
export function DocumentImage({
  cacheRef,
  requestPath,
  src,
  alt,
  className = 'docimg'
}: {
  cacheRef: React.RefObject<Map<string, Promise<string>>>
  requestPath: string
  src: string
  alt: string
  className?: string
}): React.JSX.Element {
  if (src.startsWith('data:')) {
    return <img className={className} src={src.replace(/ /g, '%20')} alt={alt} />
  }
  if (/^https?:\/\//i.test(src)) return <img className={className} src={src} alt={alt} />
  let decodedSrc: string
  try {
    decodedSrc = decodeURIComponent(src)
  } catch {
    decodedSrc = src
  }
  return (
    <LocalDocumentImage
      key={`${requestPath}\u0000${decodedSrc}`}
      cacheRef={cacheRef}
      requestPath={requestPath}
      src={decodedSrc}
      alt={alt}
      className={className}
    />
  )
}
