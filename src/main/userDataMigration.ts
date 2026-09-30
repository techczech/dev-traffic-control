import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const STORE_FILENAMES = [
  'settings.json',
  'ticks.json',
  'inbox-state.json',
  'reading-progress.json'
] as const

type MigrationLogger = (message: string, error: unknown) => void
type CopyFile = (source: string, destination: string) => void

function exists(filePath: string): boolean {
  try {
    statSync(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function logSafely(logger: MigrationLogger, message: string, error: unknown): void {
  try {
    logger(message, error)
  } catch {
    // Logging must not turn a recoverable migration failure into a startup failure.
  }
}

function cleanMigrationTemporaries(newUserDataDir: string, logger: MigrationLogger): void {
  try {
    if (!exists(newUserDataDir)) return
    for (const entry of readdirSync(newUserDataDir)) {
      if (STORE_FILENAMES.some((filename) => entry.startsWith(`${filename}.migrate-tmp-`))) {
        rmSync(join(newUserDataDir, entry), { force: true })
      }
    }
  } catch (error) {
    logSafely(
      logger,
      'Could not clean stale Dev Traffic Control migration files; continuing.',
      error
    )
  }
}

/**
 * Preserve app-local state after Electron's package-name-derived userData path
 * changes. The legacy directory remains untouched as a recovery copy.
 */
export function migrateLegacyUserData(
  newUserDataDir: string,
  logger: MigrationLogger = (message, error) => console.error(message, error),
  copyFile: CopyFile = copyFileSync
): void {
  const oldUserDataDir = join(dirname(newUserDataDir), 'qa-probe')

  // Cleanup owns a migration-specific namespace and runs even when the legacy
  // source has gone. It never creates the destination directory.
  cleanMigrationTemporaries(newUserDataDir, logger)

  try {
    if (!exists(oldUserDataDir)) return
  } catch (error) {
    logSafely(logger, 'Could not inspect legacy Dev Traffic Control state; continuing.', error)
    return
  }

  for (const filename of STORE_FILENAMES) {
    const oldFile = join(oldUserDataDir, filename)
    const newFile = join(newUserDataDir, filename)
    const temporaryFile = `${newFile}.migrate-tmp-${process.pid}`

    try {
      if (!exists(oldFile)) continue
      mkdirSync(newUserDataDir, { recursive: true })
      if (exists(newFile)) continue
      copyFile(oldFile, temporaryFile)
      // Preserve the final name when another process completed the migration
      // while this copy was in flight.
      if (exists(newFile)) {
        rmSync(temporaryFile, { force: true })
        continue
      }
      renameSync(temporaryFile, newFile)
    } catch (error) {
      logSafely(
        logger,
        `Could not migrate legacy Dev Traffic Control state file ${filename}; continuing.`,
        error
      )
    }
  }
}
