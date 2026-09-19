export interface RuntimeSettingCommitOptions<T> {
  previous: T
  next: T
  apply: (value: T) => void | Promise<void>
  persist: () => Promise<void>
}

// Use this only for reversible runtime settings whose durable value must never
// advertise a transition before the matching process state is active.
export async function commitRuntimeSetting<T>(options: RuntimeSettingCommitOptions<T>): Promise<void> {
  await options.apply(options.next)
  try {
    await options.persist()
  } catch (error) {
    await options.apply(options.previous)
    throw error
  }
}
