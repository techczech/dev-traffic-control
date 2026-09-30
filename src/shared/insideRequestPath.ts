/**
 * The one rule for a path relative to the request folder: not empty, not
 * absolute, no backslash, and no `..` segment. The report validator refuses
 * what this refuses, and the mark-up view offers only pictures it accepts.
 */
export function isInsideRequestPath(value: string): boolean {
  return (
    value !== '' &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').some((segment) => segment === '..')
  )
}
