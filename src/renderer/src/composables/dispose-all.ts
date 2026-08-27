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
