const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Age =
  | { kind: 'invalid' }
  /** Today: the clock time is printed. */
  | { kind: 'today'; value: Date }
  | { kind: 'yesterday' }
  | { kind: 'date'; value: Date; includeYear: boolean }

function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
}

function classifyAge(iso: string, now: Date): Age {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return { kind: 'invalid' }

  const dayDifference = calendarDay(now) - calendarDay(value)

  if (dayDifference <= 0) return { kind: 'today', value }
  if (dayDifference === 1) return { kind: 'yesterday' }
  if (dayDifference >= 2) {
    return {
      kind: 'date',
      value,
      includeYear: value.getFullYear() !== now.getFullYear()
    }
  }

  return { kind: 'today', value }
}

/** 24-hour clock time, `09:05`. */
function clockTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

function dateLabel(value: Date, includeYear: boolean, includeWeekday: boolean): string {
  const weekday = includeWeekday ? `${WEEKDAYS[value.getDay()]} ` : ''
  const year = includeYear ? ` ${value.getFullYear()}` : ''
  return `${weekday}${value.getDate()} ${MONTHS[value.getMonth()]}${year}`
}

export function formatDenseAge(iso: string, now: Date): string {
  const age = classifyAge(iso, now)
  switch (age.kind) {
    case 'invalid':
      return ''
    case 'today':
      return clockTime(age.value)
    case 'yesterday':
      return 'yesterday'
    case 'date':
      return dateLabel(age.value, age.includeYear, false)
  }
}

export function formatFullAge(iso: string, now: Date): string {
  const age = classifyAge(iso, now)
  switch (age.kind) {
    case 'invalid':
      return 'unknown time'
    case 'today':
      return `today ${clockTime(age.value)}`
    case 'yesterday':
      return 'yesterday'
    case 'date':
      return dateLabel(age.value, age.includeYear, true)
  }
}

/**
 * The dense form for a value that may be a bare day (`since: 2026-01-27` on a
 * release row) or a full timestamp. A bare day has no clock time,
 * so today reads "today" rather than a midnight time; it is read as that day
 * where the reviewer is, never shifted by the UTC offset.
 */
export function formatDenseDay(value: string, now: Date): string {
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!day) return formatDenseAge(value, now)
  const local = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12)
  const age = classifyAge(local.toISOString(), now)
  return age.kind === 'today' ? 'today' : formatDenseAge(local.toISOString(), now)
}

/** The exact day and time, for hovering over a row's short date. */
export function exactTime(iso: string): string | undefined {
  // A bare day (a release row's `since:`) has no time to show.
  const day = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (day) {
    return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).toLocaleDateString(
      'en-GB',
      { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    )
  }
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return undefined
  return time.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
