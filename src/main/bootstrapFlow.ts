export async function bootstrapRecordRoot<T>(
  root: string,
  previousRoot: string,
  restartNeeded: boolean,
  dependencies: {
    ensureRoot(root: string): Promise<void>
    restartService(root: string): Promise<void>
    persistRoot(root: string): Promise<T>
  }
): Promise<T> {
  await dependencies.ensureRoot(root)
  if (restartNeeded) {
    try {
      await dependencies.restartService(root)
    } catch (error) {
      try {
        await dependencies.restartService(previousRoot)
      } catch (rollbackError) {
        console.error('Record service could not restore the previous folder', rollbackError)
      }
      throw error
    }
  }
  try {
    return await dependencies.persistRoot(root)
  } catch (error) {
    if (restartNeeded) {
      try {
        await dependencies.restartService(previousRoot)
      } catch (rollbackError) {
        console.error('Record service could not restore the previous folder', rollbackError)
      }
    }
    throw error
  }
}
