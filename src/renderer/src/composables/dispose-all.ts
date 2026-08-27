export function disposeAll(callbacks: Iterable<() => void>): void {
  const failures: unknown[] = []
  for (const callback of callbacks) {
    try {
      callback()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Multiple resource disposers failed')
}

export function registerDisposers(
  registrations: Iterable<() => () => void>,
  beforeRollback: () => void = () => undefined
): (() => void)[] {
  const disposers: (() => void)[] = []
  try {
    for (const register of registrations) disposers.push(register())
    return disposers
  } catch (registrationError) {
    const failures = [registrationError]
    try {
      beforeRollback()
    } catch (error) {
      failures.push(error)
    }
    try {
      disposeAll(disposers)
    } catch (error) {
      if (error instanceof AggregateError) failures.push(...(error.errors as unknown[]))
      else failures.push(error)
    }
    if (failures.length === 1) throw registrationError
    throw new AggregateError(failures, 'Resource registration failed and rollback was incomplete')
  }
}
