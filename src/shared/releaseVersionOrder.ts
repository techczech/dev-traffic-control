export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = numericVersion(left)
  const rightParts = numericVersion(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function numericVersion(version: string): number[] {
  const core = version.replace(/^\D+/, '').split(/[-+]/, 1)[0]
  return core.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

/** `x.y.z` from a candidate like `0.22.0-beta.2`, `v0.37` or `0.37.0`; `''` otherwise. */
export function versionCore(text: string | undefined): string {
  const match = (text ?? '').match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/)
  return match ? `${match[1]}.${match[2]}.${match[3] ?? '0'}` : ''
}
