import path from 'node:path'
import { DEEP_LINK_SCHEME } from '../shared/deepLink'

export interface ProtocolClientRegistration {
  scheme: string
  /** Present only in development; an installed build registers itself. */
  execPath?: string
  args?: string[]
}

/**
 * What to hand `app.setAsDefaultProtocolClient`.
 *
 * An installed build registers its own bundle and needs nothing else. **In
 * development the scheme must be registered with `process.execPath` and the
 * app path**, or a `dtc://` link opens the installed Dev Traffic Control
 * instead of the build being worked on — which costs an afternoon before
 * anybody suspects the registration (mechanism.md § 2).
 */
export function protocolClientRegistration(
  isPackaged: boolean,
  execPath: string,
  argv: readonly string[]
): ProtocolClientRegistration {
  if (isPackaged) return { scheme: DEEP_LINK_SCHEME }
  const appPath = argv[1]
  if (!appPath || appPath.startsWith('-')) return { scheme: DEEP_LINK_SCHEME }
  return { scheme: DEEP_LINK_SCHEME, execPath, args: [path.resolve(appPath)] }
}
