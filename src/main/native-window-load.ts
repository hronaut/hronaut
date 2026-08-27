export interface NativeWindowLoadTarget {
  loadURL(url: string): Promise<void>
  isDestroyed(): boolean
  destroy(): void
}

export async function loadNativeWindowWithRollback(
  target: NativeWindowLoadTarget,
  url: string,
  resetOwner: () => void
): Promise<void> {
  try {
    await target.loadURL(url)
  } catch (loadError) {
    const rollbackErrors: unknown[] = []
    try {
      // Clear the application-level owner before destroying the native object;
      // its synchronous `closed` event must not keep or reuse this candidate.
      resetOwner()
    } catch (error) {
      rollbackErrors.push(error)
    }
    try {
      if (!target.isDestroyed()) target.destroy()
    } catch (error) {
      rollbackErrors.push(error)
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [loadError, ...rollbackErrors],
        'Native window loading failed and its rollback was incomplete'
      )
    }
    throw loadError
  }
}
