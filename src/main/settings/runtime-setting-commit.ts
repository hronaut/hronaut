import { LocalizedError } from '../localized-error.js'

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
      throw new LocalizedError('appErrors.settings.runtimeRollbackFailed', undefined, { cause: new AggregateError([applyError, rollbackError]) })
    }
    throw applyError
  }
  try {
    await options.persist()
  } catch (persistError) {
    try {
      await options.apply(options.previous)
    } catch (rollbackError) {
      throw new LocalizedError('appErrors.settings.runtimePersistFailed', undefined, { cause: new AggregateError([persistError, rollbackError]) })
    }
    throw persistError
  }
}
