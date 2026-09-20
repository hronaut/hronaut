export interface RuntimeSettingCommitOptions<T> {
  previous: T
  next: T
  apply: (value: T) => void | Promise<void>
  persist: () => Promise<void>
}

// Use this only for reversible runtime settings whose durable value must never
// advertise a transition before the matching process state is active.
export async function commitRuntimeSetting<T>(options: RuntimeSettingCommitOptions<T>): Promise<void> {
  try {
    await options.apply(options.next)
  } catch (applyError) {
    try {
      await options.apply(options.previous)
    } catch (rollbackError) {
      throw new AggregateError(
        [applyError, rollbackError],
        'The runtime setting change failed and its previous state could not be restored'
      )
    }
    throw applyError
  }
  try {
    await options.persist()
  } catch (persistError) {
    try {
      await options.apply(options.previous)
    } catch (rollbackError) {
      throw new AggregateError(
        [persistError, rollbackError],
        'The runtime setting could not be persisted or restored'
      )
    }
    throw persistError
  }
}
