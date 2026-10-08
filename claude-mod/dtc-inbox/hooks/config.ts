import { expandHome, trimSlashes } from './paths'

export type Config = {
  /** The records folder. */
  root: string
  /** A folder whose sessions see every project's answers; `''` when not set. */
  hubDir: string
  bandMs: number
}

/** `root` is the app's own default records folder. `hubDir` has no default: unset, every session sees its own project only. */
export const DEFAULTS = { root: '~/Documents/Dev Traffic Control', hubDir: '', bandSeconds: 60 }

const seconds = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 5 ? v : fallback)
const text = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback)

/** The plugin's options (`userConfig`) with defaults, `~` expanded. Options this version does not have are ignored. */
export function resolveConfig(options: Readonly<Record<string, unknown>>, home: string): Config {
  const hub = text(options.hubDir, DEFAULTS.hubDir)
  return {
    root: trimSlashes(expandHome(text(options.dtcRoot, DEFAULTS.root), home)),
    hubDir: hub === '' ? '' : trimSlashes(expandHome(hub, home)),
    bandMs: seconds(options.bandRefreshSeconds, DEFAULTS.bandSeconds) * 1000,
  }
}
