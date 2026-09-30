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
