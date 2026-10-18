/**
 * Show a path with the home directory shortened to `~`. Main passes the real
 * home directory; the renderer has none, so it passes nothing and the usual
 * `/Users/<name>` or `/home/<name>` prefix is shortened instead.
 */
export function tildePath(absolute: string, home?: string): string {
  const normal = absolute.replace(/\\/g, '/')
  const prefix =
    home?.replace(/\\/g, '/') ?? normal.match(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+/)?.[0]
  if (!prefix) return absolute
  const base = prefix.replace(/\/+$/, '')
  if (normal === base) return '~'
  return normal.startsWith(`${base}/`) ? `~${normal.slice(base.length)}` : absolute
}
