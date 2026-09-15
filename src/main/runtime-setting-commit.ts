export interface RuntimeSettingCommitOptions<T> {
  previous: T
  next: T
  apply: (value: T) => void
  persist: () => Promise<void>
}

// Use this only for reversible runtime settings whose durable value must never
// advertise a transition before the matching process state is active.
export async function commitRuntimeSetting<T>(options: RuntimeSettingCommitOptions<T>): Promise<void> {
  options.apply(options.next)
  try {
    await options.persist()
  } catch (error) {
    options.apply(options.previous)
    throw error
  }
}
