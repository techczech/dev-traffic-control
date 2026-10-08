/**
 * Show a path with the home directory shortened to `~`. Main passes the real
 * home directory; the renderer has none, so it passes nothing and the usual
 * `/Users/<name>` or `/home/<name>` prefix is shortened instead.
 */
export function tildePath(absolute: string, home?: string): string {
  const prefix = home ?? absolute.match(/^\/(?:Users|home)\/[^/]+/)?.[0]
  if (!prefix) return absolute
  const base = prefix.replace(/\/+$/, '')
  if (absolute === base) return '~'
  return absolute.startsWith(`${base}/`) ? `~${absolute.slice(base.length)}` : absolute
}
