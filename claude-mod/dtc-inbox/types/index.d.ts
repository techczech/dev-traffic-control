export type ScanCacheState = Record<string, { mtimeMs: number; size?: number; s: unknown }>

export type InboxBand = { count: number; at: number; /** How many file reads the scan behind this count put off to later scans. */ unread?: number }

declare module 'claude-code' {
  interface PluginState {
    'dtc-inbox': {
      /** Waiting answers counted for this session's band. */
      band: InboxBand | null
      /** Parse cache keyed by file path (report, roadmap idea, release answers, request title, opened and watch markers), valid for the size and mtime it holds. */
      scanCache: ScanCacheState
      /** Request paths written in the running turn, for the link check. */
      turnWrites: string[]
      /** Records this session filed (path → project, first and latest filing time). The pane lists them, and dtc_answers uses the first time to tell an answer given before the request was filed from one given after. */
      filed: Record<string, { project: string; filedAt: number; lastAt?: number }>
    }
  }
}
