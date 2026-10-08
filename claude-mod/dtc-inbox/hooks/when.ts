/** Human times for the /dtc pane and text. Pure: `now` and the time zone are injected. */

/** Offset east of UTC, in minutes, at an instant (so daylight saving is per timestamp). */
export type Tz = (ms: number) => number

export const localTz: Tz = ms => -new Date(ms).getTimezoneOffset()

const DAY = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number): string => String(n).padStart(2, '0')
const shifted = (ms: number, tz: Tz): Date => new Date(ms + tz(ms) * 60_000)
const dayNumber = (ms: number, tz: Tz): number => Math.floor((ms + tz(ms) * 60_000) / DAY)

/**
 * `today 14:05`, `yesterday 08:52`, `Thu 08:11` (within the last 7 days), `12 Sep`, `12 Sep 2025` (older dates carry no clock).
 * With `dateOnly` the clock part is left off the recent forms too. An instant in the future reads as today.
 */
export function formatWhen(ms: number, now: number, tz: Tz, dateOnly = false): string {
  const local = shifted(ms, tz)
  const clock = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  const ago = dayNumber(now, tz) - dayNumber(ms, tz)
  let day: string
  if (ago <= 0) day = 'today'
  else if (ago === 1) day = 'yesterday'
  else if (ago < 7) day = WEEKDAYS[local.getUTCDay()] as string
  else {
    day = `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()] as string}`
    if (local.getUTCFullYear() !== shifted(now, tz).getUTCFullYear()) day += ` ${local.getUTCFullYear()}`
    return day
  }
  return dateOnly ? day : `${day} ${clock}`
}
