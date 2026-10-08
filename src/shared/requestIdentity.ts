const normalise = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')

/** The request path relative to the configured record root, including `.md`. */
export function requestIdentity(recordRoot: string, requestPath: string): string {
  const root = normalise(recordRoot)
  const candidate = normalise(requestPath)
  const prefix = `${root}/`
  if (candidate.startsWith(prefix)) return candidate.slice(prefix.length)
  return candidate.replace(/^\.\//, '')
}

/** The pre-0.12 key used by ticks and inbox state. */
export function legacyRequestIdentity(identity: string): string {
  return (normalise(identity).split('/').pop() ?? identity).replace(/\.md$/, '')
}

export function legacyOwners(requestIdentities: readonly string[]): Map<string, string[]> {
  const candidates = new Map<string, string[]>()
  for (const identity of requestIdentities) {
    const legacy = legacyRequestIdentity(identity)
    const matches = candidates.get(legacy)
    if (matches) matches.push(identity)
    else candidates.set(legacy, [identity])
  }
  return candidates
}

/** Legacy state is readable only by the sole live owner of that basename. */
export function hasRequestIdentity(
  keys: ReadonlySet<string>,
  identity: string,
  liveRequestIdentities: readonly string[] = []
): boolean {
  if (keys.has(identity)) return true
  const owners = legacyOwners(liveRequestIdentities).get(legacyRequestIdentity(identity)) ?? []
  return owners.length === 1 && owners[0] === identity && keys.has(legacyRequestIdentity(identity))
}

export function unambiguousLegacyMigrations(
  requestIdentities: readonly string[]
): Map<string, string> {
  const candidates = legacyOwners(requestIdentities)
  return new Map(
    [...candidates]
      .filter(([, identities]) => identities.length === 1)
      .map(([legacy, identities]) => [legacy, identities[0]])
  )
}

export function requestIdentityIsLive(
  storedKey: string,
  liveRequestIdentities: ReadonlySet<string>,
  protectedLegacyKeys: ReadonlySet<string> = new Set()
): boolean {
  if (liveRequestIdentities.has(storedKey)) return true
  if (protectedLegacyKeys.has(storedKey)) return true
  return [...liveRequestIdentities].some(
    (identity) => legacyRequestIdentity(identity) === storedKey
  )
}
